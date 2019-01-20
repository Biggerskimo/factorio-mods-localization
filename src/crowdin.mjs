import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import uuid from 'uuid';
import download from 'download';
import assert from 'assert';
import Case from 'case';
import { ROOT } from './constants';
import { deleteEmptyIniFiles } from './utility';
import Raven from 'raven';

export function getCrowdinDirectoryName(fullName) {
    const [owner, repo] = fullName.split('/');
    return `${Case.capital(repo)} (${owner})`;
}

export function replaceIniToCfg(fileName) {
    return fileName.replace(/.ini$/, '.cfg');
}

export function replaceCfgToIni(fileName) {
    return fileName.replace(/.cfg$/, '.ini');
}

function getCrowdinErrorCode(error) {
    return error.response && error.response.data && error.response.data.error && error.response.data.error.code;
}

class CrowdinApi {
    constructor() {
        this.projectId = process.env.CROWDIN_PROJECT_ID;
        this.apiKey = process.env.CROWDIN_API_KEY;
        if (!this.projectId || !this.apiKey) {
            console.error('Environment variables CROWDIN_PROJECT_ID and CROWDIN_API_KEY must be set');
            process.exit(1);
        }
        this.axios = axios.create({
            // baseURL: 'https://httpbin.org/post',
            baseURL: `https://api.crowdin.com/api/project/${this.projectId}`,
            params: {
                key: this.apiKey,
                json: true,
            },
        });

        this.axios.interceptors.response.use(null, error => {
            if (error.response && error.response.data && error.response.data.error && error.response.data.error) {
                console.error(
                    error.response.data.error.message + '\n'
                    + '\t' + error.config.url + '\n'
                    + '\t' + JSON.stringify(error.config.params));
            }
            return Promise.reject(error);
        });
    }

    async init() {
        const response = (await this.axios.get('/supported-languages')).data;
        this.allLanguageCodes = response.map(language => language.crowdin_code);
        assert(this.allLanguageCodes.length > 20);
    }

    getCrowdinDirectory(repository) {
        return new CrowdinDirectory(this.axios, repository);
    }

    async getProjectInfo() {
        return (await this.axios.post('/info')).data;
    }

    async getProjectLanguageCodes() {
        const response = await this.getProjectInfo();
        return response.languages.map(language => language.code);
    }

    async getAllDirectoriesNames() {
        const info = await this.getProjectInfo();
        return info.files.map(directory => directory.name);
    }

    async filterRepositories(repositories) {
        const directoriesNames = await this.getAllDirectoriesNames();
        return repositories.filter(repository => directoriesNames.includes(getCrowdinDirectoryName(repository.fullName)));
    }

    async exportTranslations() {
        const response = (await this.axios.get('/export')).data;
        if (!response.success || response.success.status !== 'built') {
            console.warn('[crowdin] [*] export translations has no effect (no changes since last export)');
        }
    }

    async downloadAllTranlations() {
        await this.exportTranslations();
        const url = `https://api.crowdin.com/api/project/${this.projectId}/download/all.zip?key=${this.apiKey}`;
        const destinationDirectory = path.join(ROOT, uuid.v4());
        await download(url, destinationDirectory, { extract: true });
        await deleteEmptyIniFiles(destinationDirectory);
        return destinationDirectory;
    }

    async editProject(project) {
        await this.axios.post('/edit-project', null, { params: project });
    }

    // for debug
    async deleteAllDirectories() {
        for (const name of await this.getAllDirectoriesNames()) {
            await this.deleteDirectory(name);
        }
    }

    async deleteDirectory(name) {
        assert(name.endsWith('(dima74)') || name.endsWith('(factorio-mods-helper)'));
        const params = { name };
        await this.axios.post('/delete-directory', null, { params });
    }
}

class CrowdinDirectory {
    constructor(axios, repository) {
        this.axios = axios;
        this.repository = repository;
        this.directoryName = getCrowdinDirectoryName(repository.fullName);
    }

    async onRepositoryAdded() {
        await this.checkRepositoryLanguages();
        await this.createRepositoryDirectory();
        await this.addEnglishFiles();
        await this.addAllLocalizations();
    }

    getCrowdinFileInfo(filePath) {
        const fileName = replaceCfgToIni(path.basename(filePath));
        return [`${this.directoryName}/${fileName}`, fileName];
    }

    async checkRepositoryLanguages() {
        // получает список всех подпапок папки /languages
        // если есть неподдерживаемый язык (https://support.crowdin.com/api/language-codes/), то выбрасывается исключение
        // если нужно, отправляется запрос на изменение проекта на crowdin (добавление отсутствующих языков)

        const repositoryLanguageCodes = await this.repository.getLanguageCodes();
        const allLanguageCodes = crowdinApi.allLanguageCodes;
        const unsupportedLanguageCodes = repositoryLanguageCodes.filter(code => !allLanguageCodes.includes(code));
        if (unsupportedLanguageCodes.length > 0) {
            throw Error(`[crowdin] [${this.repository.fullName}] found unsupported languages: ${JSON.stringify(unsupportedLanguageCodes)}`);
        }

        const projectLanguageCodes = await crowdinApi.getProjectLanguageCodes();
        const newLanguageCodes = repositoryLanguageCodes.filter(code => !projectLanguageCodes.includes(code) && code !== 'en');
        if (newLanguageCodes.length > 0) {
            console.log(`[add-repository] [${this.repository.fullName}] found new languages: ${JSON.stringify(newLanguageCodes)}`);
            const newProjectLanguageCodes = [...projectLanguageCodes, ...newLanguageCodes];
            await crowdinApi.editProject({ languages: newProjectLanguageCodes });
        }
    }

    async createRepositoryDirectory() {
        try {
            const params = {
                name: this.directoryName,
                recursive: 1,
            };
            await this.axios.post('/add-directory', null, { params });
        } catch (error) {
            if (getCrowdinErrorCode(error) === 50) {
                throw Error('[crowdin] directory already exists');
                // todo handle error (merge folders or something else)
            } else {
                throw error;
            }
        }
    }

    async addEnglishFiles() {
        for (const filePath of await this.repository.getEnglishFiles()) {
            await this.addEnglishFile(filePath);
        }
    }

    async postLocalizationFile(urlPath, filePath, params = {}) {
        const form = new FormData();
        const [crowdinFilePath, crowdinFileName] = this.getCrowdinFileInfo(filePath);
        console.log(`[${this.repository.fullName}] crowdin${urlPath}: ${params.language || 'en'}/${crowdinFileName}`);
        form.append(`files[${crowdinFilePath}]`, fs.createReadStream(filePath), crowdinFileName);
        const headers = form.getHeaders();
        return await this.axios.post(urlPath, form, { headers, params, debugInfo: { urlPath, crowdinFilePath } });
    }

    async addEnglishFile(filePath) {
        await this.postLocalizationFile('/add-file', filePath);
    }

    async updateEnglishFile(filePath) {
        await this.postLocalizationFile('/update-file', filePath, { update_option: 'update_as_unapproved' });
    }

    async addAllLocalizations() {
        const localizations = await this.repository.getLocalizations();
        for (const localization of Object.entries(localizations)) {
            await this.addLocalization(localization);
        }
    }

    async addLocalization(localization) {
        const [languageCode, filesPaths] = localization;
        for (const filePath of filesPaths) {
            // todo we can remove this check because we keep only .cfg files repository/getDirectoryCfgFilesPaths
            if (!filePath.endsWith('.cfg') && !filePath.endsWith('.ini')) {
                console.warn(`[${this.repository.fullName}] Locale file with unknown extension: ${path.basename(filePath)}`);
                continue;
            }
            await this.addTranslatedFile(languageCode, filePath);
        }
    }

    async addTranslatedFile(languageCode, filePath) {
        const params = { language: languageCode, auto_approve_imported: 1 };

        let response;
        try {
            response = await this.postLocalizationFile('/upload-translation', filePath, params);
        } catch (error) {
            if (getCrowdinErrorCode(error) === 8) {
                console.warn(`[${this.repository.fullName}] crowdin/upload-translation: ${languageCode}/${this.getCrowdinFileInfo(filePath)[1]} — correspond english file not found`);
                Raven.captureException(error);
                return;
            } else {
                throw error;
            }
        }

        // check that all files have status 'uploaded'
        for (const [fileName, fileStatus] of Object.entries(response.data.files)) {
            if (fileStatus !== 'uploaded') {
                throw Error(`Error during uploading file "${fileName}", status: ${fileStatus}`);
            }
        }
    }

    async updateFilesOnCrowdin(filesNames) {
        const info = await crowdinApi.getProjectInfo();
        const crowdinDirectory = info.files.find(file => file.name === this.directoryName);
        assert(crowdinDirectory);
        const crowdinFiles = crowdinDirectory.files.map(file => file.name);

        // todo Promise.all
        for (const fileName of filesNames) {
            const filePath = path.join(this.repository.localeEnPath, fileName);
            if (crowdinFiles.includes(replaceCfgToIni(fileName))) {
                await this.updateEnglishFile(filePath);
            } else {
                await this.addEnglishFile(filePath);
            }
        }
    }
}

const crowdinApi = new CrowdinApi();
export default crowdinApi;
import createApp from './github-app-auth-helper';
import process from 'process';
import path from 'path';
import { ROOT } from './constants';
import uuid from 'uuid';
import Repository from './repository';
import git from 'simple-git/promise';

class GitHub {
    async init() {
        const id = process.env.GITHUB_APP_ID;
        const cert = process.env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n');

        if (!id || !cert) {
            console.error('Environment variables GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set');
            process.exit(1);
        }

        this.apiHelper = createApp({ id, cert });
    }

    async getApi() {
        // max jwtTokenLifetime for github is 10 minutes (so we can't generate token once at app startup)
        const jwtTokenLifetime = 10 * 60;
        return await this.apiHelper.asApp(jwtTokenLifetime);
    }

    async getInstallation(id) {
        const installationApi = await this.apiHelper.asInstallation(id);
        return new Installation(id, installationApi);
    }

    async getInstallationToken(id) {
        const api = await this.getApi();
        const response = await api.apps.createInstallationToken({ installation_id: id });
        return response.data.token;
    }

    async getInstallationRepositories(id) {
        const installation = await this.getInstallation(id);
        return await installation.getRepositories();
    }

    async getAllRepositories() /* [{installation, fullName}...] */ {
        // todo pagination
        const api = await this.getApi();
        const installations = (await api.apps.getInstallations({ per_page: 100 })).data;
        const installationsRepositoriesPromises = installations.map(installation => this.getInstallationRepositories(installation.id));
        const installationsRepositories = await Promise.all(installationsRepositoriesPromises);
        return [].concat(...installationsRepositories);
    }
}

class Installation {
    constructor(id, api) {
        this.id = id;
        this.api = api;
    }

    async cloneRepository(fullName) {
        if (process.env.NODE_ENV === 'development' && fullName === 'dima74/factorio-mod-example') {
            // return new Repository(fullName, '/home/dima/IdeaProjects/factorio/factorio-mod-example1');
        }

        const token = await github.getInstallationToken(this.id);
        const repoPath = `https://x-access-token:${token}@github.com/${fullName}.git`;
        const destinationDirectory = path.join(ROOT, uuid.v4());
        await git().clone(repoPath, destinationDirectory, ['--depth', '1']);
        return new Repository(fullName, destinationDirectory);
    }

    async getRepositories() {
        const response = await this.api.apps.getInstallationRepositories({ per_page: 100 });
        const repositories = response.data.repositories;
        return repositories.map(({ full_name }) => ({ installation: this, fullName: full_name }));
    }
}

const github = new GitHub();
export default github;

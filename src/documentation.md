## App responsibilities
1. Webhook for app installation: create subfolder in crowdin
1. Every week: update github from crowdin
1. Webhook for every push to update crowdin from github

## Adding github app to repository
1. Download github repository (just files, without .git folder)
1. Check for `/locale` and `/locale/en`
1. Crowdin:
    * check that for each localization file (that is file in directory like `/locale/ru`) there is corresponding english file (in `/locale/en`)
    * add languages to crowdin project if necessary (crowdin-api/edit-project)
    * crowdin-api/add-directory
    * for each file in `/locale/en`: crowdin-api/add-file
    * for each other `/locale` subfolder
        * for each subfolder file: crowdin-api/upload-translation 

## Update github from crowdin (general overview)
1. Get list of all repositories for which github app is installed
1. Filter list to contain only repositories which also are presented on crowdin
1. Download all translations from crowdin
1. Update github from crowdin (for each repository)

## Update github from crowdin (for each repository) 
1. Create installation token

    https://octokit.github.io/rest.js/#api-Apps-createInstallationToken

1. Clone repository `https://x-access-token:TOKEN@github.com/OWNER/REPO.git`

    https://developer.github.com/apps/building-github-apps/authenticating-with-github-apps/#http-based-git-access-by-an-installation

1. For each language:
    * locate language translations in downloaded files (see general overview for details)
    * copy them to cloned directory
1. Make git commit (or break if there are no changes)
1. Git push

## Webhook for every push to update crowdin from github
1. Check if pushed commits change /locale/en (Note that payload for push webhook contains added/modified/removed files)
1. For every modified/added file:
    * check if we have same file on crowdin:
        * yes: crowdin-api/update-file
        * no: crowdin-api/add-file
1. (Note that for now we will not handle file removing) 

## Notes
* We need to run some code every week (update github from crowdin). Standard Heroku scheduler mechanism is really very bad (unreliable, costly and difficult to setup). But Heroku forces our app to restart approximately every 24 hours. So we can just run necessary code on app startup. We would store in postgresql (built-in heroku database) updates time, and on startup checks, if last update time is more than week ago (if so, do update).

* Research: can we make our dyno not sleep if we will every minute send request from our app to itself (via https://factorio-mods-localization.herokuapp.com/)?

* Any localization folder (such as `/locale/en`, `/locale/ru`) may contain subfolder, and we should ignore subfolders, because factorio ignores them too. Here is [example](https://github.com/Karosieben/boblocale/tree/master/locale/en/old).

* In some mods files names doesn't match across localization folders

    Examples:
    
    * `/locale/en/en.cfg` and `/locale/ru/ru.cfg`
    * `/locale/en/Angel.cfg` and `/locale/ru/Angel_ru.cfg`
    * `/locale/en/bobenemies_0.16.0.cfg` and `/locale/ru/bobenemies.cfg`

    We researched >1000 mods and it turns out that only 8% of them has unmatched files names in different languages directories

    So for now we decided to support only matched files names in different languages (mod author has to rename languages files if their names don't match)

* Logs format:

        [action-name] [repository-name] comment

## Dependencies updates
* `axios` must not be updated to v19 because of https://github.com/axios/axios/issues/2190
* `form-data` possible should not be updated to v3: https://github.com/form-data/form-data/issues/462
* `pg` possible should not be update to v8, can't manage to apply migration guide https://node-postgres.com/announcements#2020-02-25

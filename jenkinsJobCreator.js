"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// npm install @types/node
// npm install rxjs
const http = require("http");
const rx = require("rxjs");
const fs = require("fs");
const basicCredentials = "######";
const jenkinsUrl = "http://localhost:8080/";
const gitUser = "#####";
function createJobConfig(template, properties, gitSettings) {
    let propertiesStr = "";
    properties.forEach((value, key, map) => {
        propertiesStr += "<com.mig82.folders.properties.StringProperty>\n";
        propertiesStr += ("<key>" + key + "</key>\n");
        propertiesStr += ("<value>" + value + "</value>\n");
        propertiesStr += "</com.mig82.folders.properties.StringProperty>\n";
    });
    const tokenValues = new Map(gitSettings);
    tokenValues.set("PROPERTY", propertiesStr);
    let jobStr = template;
    tokenValues.forEach((value, key, map) => {
        jobStr = jobStr.replace("###" + key + "###", value);
    });
    return jobStr;
}
function createJenkinsJob(jobName, jobConfig) {
    return new rx.Observable(observer => {
        const req = http.request(jenkinsUrl + "createItem?name=" + jobName, createDefaultHttpOptions(), resp => {
            if (!resp.statusCode)
                resp.statusCode = 404;
            if (resp.statusCode >= 200 && resp.statusCode <= 299) {
                observer.next();
            }
            else {
                observer.error("Jenkins returned HTTP status " + resp.statusCode);
            }
            observer.complete();
        });
        req.write(jobConfig);
        req.end();
    });
}
function createDefaultHttpOptions() {
    return {
        auth: basicCredentials,
        method: "POST",
        headers: {
            'Content-Type': 'application/xml'
        }
    };
}
function createJenkinsJob(job, multiBranchPipelineTemplate, folderTemplate) {
    console.log("Create job " + job.name + " (is folder? " + job.isFolder + ")");
    const gitSettings = new Map();
    gitSettings.set("GIT_USER", gitUser);
    gitSettings.set("GIT_REPO", job.gitHubUrl.substring(job.gitHubUrl.lastIndexOf("/") + 1, job.gitHubUrl.length - 4));
    gitSettings.set("GIT_URL", job.gitHubUrl);
    const jobConfig = createJobConfig(job.isFolder ? folderTemplate : multiBranchPipelineTemplate, job.properties, gitSettings);
    let rslt = createJenkinsJob(job.name, jobConfig);
    if (job.isFolder) {
        const obs = new Array();
        job.childJobs.forEach((child) => {
            obs.push(createJenkinsJob(child, multiBranchPipelineTemplate, folderTemplate));
        });
        rslt = rslt.pipe(rx.forkJoin(...obs));
    }
    return rslt;
}
rx.forkJoin(new rx.Observable(observer => {
    fs.readFile('jenskinsout.txt', 'utf8', (err, data) => {
        if (err) {
            observer.error("Error reading jenkinsout.txt : " + err);
        }
        else {
            const dataJson = JSON.parse(data, (key, value) => {
                if (typeof (value) === 'object' && value != null) {
                    if (value['dataType'] == 'Map') {
                        return new Map(value.value);
                    }
                }
                return value;
            });
            observer.next(dataJson);
        }
        observer.complete();
    });
}), new rx.Observable(observer => {
    fs.readFile('configMultiBranchPipelineTemplate.xml', 'utf8', (err, data) => {
        if (err) {
            observer.error("Error reading configMultiBranchPipelineTemplate.xml : " + err);
        }
        else {
            observer.next(data);
        }
        observer.complete();
    });
}), new rx.Observable(observer => {
    fs.readFile('configFolderTemplate.xml', 'utf8', (err, data) => {
        if (err) {
            observer.error("Error reading configFolderTemplate.xml : " + err);
        }
        else {
            observer.next(data);
        }
        observer.complete();
    });
})).pipe(rx.mergeMap(configData => {
    const rootJob = configData[0];
    const multiBranchPipelineTemplate = configData[1];
    const folderTemplate = configData[2];
    return createJenkinsJob(rootJob, multiBranchPipelineTemplate, folderTemplate);
})).subscribe();

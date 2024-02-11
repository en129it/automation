// npm install @types/node
// npm install rxjs
import http = require('http');
import rx = require('rxjs');
import fs = require('fs');

const basicCredentials = "######";
const jenkinsUrl = "http://localhost:8080/";


class LimitedResource {
	constructor(private pool: LimitedResourcePool) {}
	
	public freeResource() {
		this.pool.freeResource(this);
	}
}

class LimitedResourcePool {
	resources : Array<LimitedResource>;
	pendingRequests : Array<rx.Observer<LimitedResource>>;
	
	constructor() {
		this.resources = new Array<LimitedResource>();
		this.pendingRequests = new Array<rx.Observer<LimitedResource>>();
	}
	
	public getResource(): rx.Observable<LimitedResource> {
		console.log("Request resource");
		return new rx.Observable( (observer: rx.Observer<LimitedResource>) => {
			console.log("Request resource exec " + observer);
			this.pendingRequests.push(observer);
			const self = this;
			setTimeout( () => {
				self.proceedPendingResource();
			}, 1);
		})
	}
	
	private proceedPendingResource() {
		if ((this.pendingRequests.length > 0) && (this.resources.length <= 5)) {
			const pendingRequest = this.pendingRequests.splice(0, 1)[0];
			console.log("Requested resource granted " + pendingRequest + "    " + this.pendingRequests.length);
			const resource = new LimitedResource(this);
			this.resources.push(resource);
			pendingRequest.next(resource);
			pendingRequest.complete();
		}
	}
	
	public freeResource(resource : LimitedResource) {
		console.log("Resource freed");
		const index = this.resources.indexOf(resource);
		if (index > -1) {
			this.resources.splice(index, 1);
			this.proceedPendingResource();
		}
	}
}

class Job {
	childJobs: Array<Job>;
	public gitHubUrl?: string;
	properties: Map<string, string>;
	
	constructor(public name: string, public isFolder: boolean, public parent?: Job) {
		this.childJobs = new Array<Job>();
		this.properties = new Map<string, string>();
	}
	
	public addChildJob(job: Job) {
		this.childJobs.push(job);
	}
	
	public addProperty(key: string, value: string) {
		this.properties.set(key, value);
	}
	
	public toString(): string {
		return this.name + "[parentPath=" + this.getParentPath() + ", gitHubUrl=" + this.gitHubUrl + ", properties=[" + this.toStringProperties("(Key=$key,Value=$value)", "$key", "$value", "") + "], chidren=" + this.childJobs.join(" , ") + "]";
	}

	public toStringProperties(format: string, keyToken: string, valueToken: string, propSeparator: string): string {
		let rslt = "";
		let isFirst = true;
		this.properties.forEach((value, key, map) => {
			rslt += ((!isFirst) ? propSeparator : "") + format.replace(keyToken, key).replace(valueToken, value);
			isFirst = false;
		});
		return rslt;
	}
	
	private static getJobPathHelper(job?: Job): string {
		if (job) {
			const parentJobPath = Job.getJobPathHelper(job.parent);
 			return parentJobPath + (parentJobPath != "" ? "/": "") + job.name;
		} else {
			return "";
		}
	}

	public getParentPath(): string {
		return Job.getJobPathHelper(this);
	}
	
	public applyJobFct(fct : (j: Job) => any ) {
		fct(this);
		this.childJobs.forEach( c => c.applyJobFct(fct) );
	}
}

function extractJobs(parent: Job): rx.Observable<void> {
	return resourcePool.getResource()
		.pipe(rx.flatMap((r : LimitedResource) => extractJobsHelper(parent, r)));
}

function buildJobUrlPath(job?: Job): string {
	if (job) {
		return buildJobUrlPath(job.parent) + ((job.name) ? ("job/" + job.name + "/") : "");
	}
	return "";
}

function extractJobsHelper(parent: Job, r: LimitedResource): rx.Observable<void> {
	console.log("Extract Jobs (parent" + parent.name +")");
	return new rx.Observable(observer => {
		const options = createDefaultHttpOptions();
		console.log("- URL" + jenkinsUrl + buildJobUrlPath(parent) + "api/json?tree=jobs[name]");
		const req = http.request(jenkinsUrl + buildJobUrlPath(parent) + "api/json?tree=jobs[name]", options, resp => {
			let dataJson = "";
			resp.on("data", data => {
				dataJson += data.toString();
			});
			resp.on("end", () => {
				const data = JSON.parse(dataJson);
				const jobList = data.jobs;
				
				const obs = new Array<rx.Observable<void>>();
				jobList.forEach((j:any) => {
					const isFolder = "com.cloudbees.hudson.plugins.folder.Folder" === j["_class"];
					const job = new Job(j["name"], isFolder, parent);
					console.log("- Create job " + job.name);
					parent.addChildJob(job);
					if (isFolder) {
						console.log("- Job is folder");
						obs.push(extractJobs(job));
					}
					
				});
				r.freeResource();
				
				if (obs.length > -1) {
					rx.forkJoin(...obs)
						.subscribe( (a) => observer.next(), (e) => {}, () => observer.complete() );
				} else {
					observer.next();
					observer.complete();
				}
			});
		});
		req.end();
	});
}

function extractSection(text: string, startKeyWord: string, endKeyWord: string): string {
	const startIndex = text.indexOf(startKeyWord);
	if (startIndex > -1) {
		const endIndex = text.indexOf(endKeyWord, startIndex + 1);
		if (endIndex > -1) {
			return text.substring(startIndex + startKeyWord.length, endIndex);
		}	
	}
	return "";
}

function extractKeyValues(text: string, job: Job) {
	const key = extractSection(text, "<key>", "</key>");
	const value = extractSection(text, "<value>", "</value>");
	
	if (key != "" && value != "") {
		job.addProperty(key, value);
	
		let term = text.indexOf("</value>");
		if (term == -1) {
			term = text.indexOf("<value/>");
		}
		
		extractKeyValues(text.substring(term + 1), job);
	}
}

function extractJobSettings(job: Job): rx.Observable<void> {
	return resourcePool.getResource()
		.pipe(rx.flatMap((r : LimitedResource) => extractJobSettingsHelper(job, r)));
}

function extractJobSettingsHelper(job: Job, r: LimitedResource) : rx.Observable<void> {
	console.log("Extract Job Properties (job " + job.name +")");
	return new rx.Observable(observer => {
		const options = createDefaultHttpOptions();
		console.log("- URL" + jenkinsUrl + buildJobUrlPath(job) + "config.xml");
		const req = http.request(jenkinsUrl + buildJobUrlPath(job) + "config.xml", options, resp => {
			resp.on("data", data => {
				let dataStr = data.toString();
				// Properties extraction
				let propertiesSectionStr = extractSection(dataStr, "FolderProperties", "FolderProperties");
				if (propertiesSectionStr != "") {
					propertiesSectionStr = extractSection(propertiesSectionStr, "<properties>", "</properties>");
					if (propertiesSectionStr != "") {
						extractKeyValues(propertiesSectionStr, job);	
					}
				}
				// GitHub extraction
				const gitHubSectionStr = extractSection(dataStr, '<sources class="jenkins.branch.MultiBranchProject$BranchSourceList"', "</sources>");
				if (gitHubSectionStr != "") {
					job.gitHubUrl = extractSection(gitHubSectionStr, "<repositoryUrl>", "</repositoryUrl>");
				}
				r.freeResource();
				observer.next();
				observer.complete();
				console.log("- Extract Job Properties (job " + job.name +") completed");
			});
		});
		req.end();
	});
}

function createDefaultHttpOptions(): any {
	return {
		auth: basicCredentials,
		headers: {
			'Accept': 'application/json'
		}
	};
}

const resourcePool = new LimitedResourcePool();

const jobRoot = new Job("", false);
extractJobs(jobRoot).subscribe( () => {}, () => {}, () => {
	const obs = new Array<rx.Observable<void>>();
	jobRoot.applyJobFct( j => {
		obs.push(extractJobSettings(j));
	});
	rx.forkJoin(...obs).subscribe( () => {}, () => {}, () => {
		const jsonRslt = JSON.stringify(jobRoot, (key, value) => {
			if (key != "parent") {
				if (value instanceof Map) {
					return {
						dataType: "Map",
						values: Array.from((<Map<string, string>>value).entries())
					};
				}
				return value;
			}
		});
		fs.writeFile("jenskinsout.txt", jsonRslt, (err) => {
			if (err) {
				console.error("Error during JSON persistence", err);
			}
		});
	});
});


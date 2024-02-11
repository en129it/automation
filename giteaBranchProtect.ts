import http = require("http");
import rx = require("rxjs");

const giteaApiBaseUrl = "http://localhost:3000/api/v1/";
const token = "######";
const org = "######";
const branchToProtect = "main";

function searchAllRepositories(): rx.Observable<Array<string>> {
	return new rx.Observable( observer => {
		const req = http.request(giteaApiBaseUrl + `repos/search`, createDefaultHttpOptions("GET"), resp => {
			let data = "";
			resp.on("data", partData => {
				data += partData;
			});
			resp.on("end", () => {
				const dataJSON = JSON.parse(data);
				const rslt = dataJSON.data.map( (i: any) => i["name"] );
				observer.next(rslt);
				observer.complete();
			});
		});
		req.end();
	});
}

function hasBranchProtection(org: string, repo: string): rx.Observable<boolean> {
	return new rx.Observable( observer => {
		const req = http.request(giteaApiBaseUrl + `repos/${org}/${repo}/branch_protections`, createDefaultHttpOptions("GET"), resp => {
			let data = "";
			resp.on("data", partData => {
				data += partData.toString();
			});
			resp.on("end", () => {
				observer.next(!data.startsWith("[]"));
				observer.complete();
			});
		});
		req.end();
	});
}

function setBranchProtection(org: string, repo: string, branchName: string, teamName: string): rx.Observable<void> {
	const protectionSettings = {  
		branch_name:branchName,
		rule_name:branchName,
		enable_push:true,
		enable_push_whitelist:true,
		push_whitelist_usernames:[teamName],
		push_whitelist_teams:[],
		push_whitelist_deploy_keys:true,
		enable_merge_whitelist:false,
		merge_whitelist_usernames:[teamName],
		merge_whitelist_teams:[],
		enable_status_check:false,
		status_check_contexts:null,
		required_approvals:0,
		enable_approvals_whitelist:false,
		approvals_whitelist_teams:[teamName],
		approvals_whitelist_username:[],
		block_on_official_review_requests:false,
		block_on_rejected_reviews:false,
		block_on_outdated_branch:false,
		dismiss_stale_approvals:false,
		require_signed_commits:false,
		protected_file_patterns:"",
		unprotected_file_patterns:"" 
	};

	return new rx.Observable( observer => {
		const req = http.request(giteaApiBaseUrl + `repos/${org}/${repo}/branch_protections`, createDefaultHttpOptions("POST"), resp => {
			resp.on("end", () => { });
			resp.on("data", (d) => { 
				console.log("Complete before " + resp.statusCode);
				if (resp.statusCode == 201 || resp.statusCode == 200) {
					console.log("Complete");
					observer.next();
					observer.complete();
				}
			});
		});
		req.write(JSON.stringify(protectionSettings));
		req.end();
	});
}

function createDefaultHttpOptions(method: string): any {
	return {
		method: method,
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
			'Authorization': 'token ' + token
		}
	};
}

searchAllRepositories().pipe(rx.mergeMap( (repoNames: Array<string>) => {
	return rx.forkJoin(...repoNames.map( repoName => hasBranchProtection(org, repoName)
		.pipe(rx.mergeMap( (hasProtection: boolean) => {
			console.log("Repo " + repoName + " has protection ? " + hasProtection);
			if (!hasProtection) {
				return setBranchProtection(org, repoName, branchToProtect, org);
			} else {
				return new rx.Observable(observer => { observer.next(); observer.complete(); });
			}
		})) 
	))
})).subscribe();


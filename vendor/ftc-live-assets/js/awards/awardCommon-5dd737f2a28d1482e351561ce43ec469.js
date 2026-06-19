function isRobotAward(a){
	return a.awardTypeId == 12 || a.awardTypeId == 13 || a.awardTypeId == 22 || a.awardTypeId == 23 || a.awardTypeId == 24;
}
function isDivisionAward(a) {
	return a.awardTypeId == 22 || a.awardTypeId == 23;
}
function isConferenceAward(a) {
	return a.awardTypeId == 24;
}
function isValid(name){
	return name && name !== "";
}
function cannotDuplicate(id1, id2){
	let valid = function(id){
		return (id > 3 && id < 10) || id == 11 || id == 1;
	} 
	return valid(id1) && valid(id2);
}
function isRequired(a){
	return a.awardTypeId > 3 && a.awardTypeId < 12 && a.awardTypeId !=10;
}

/**
 * Handle the differences between cloud and local Team data structure
 * @param assign
 */
function validateTeamData(assign){
	if (assign.team && !assign.team.data) {
		assign.team.data = assign.team;
		assign.team.data.name = assign.team.shortName;
		assign.team.data.state = assign.team.stateProv;
	}
}
function getAwardsURL(end) {
	if (CLOUD) {
		return '../awards/' + end;
	} else {
		return '../../awards/' + end + '/';
	}
}
/* Handle cloud data model's separation of award and award assignments*/
function mergeAwardsAndAssignments(awardMap) {
	if (!CLOUD) {
		return awardMap;
	}
	let awards = awardMap.awards;
	if (awards.length === 1) {
		awards[0].assignments = !awardMap.assignments ? [] : awardMap.assignments;
		return awards;
	}
	for (let i = 0; i < awards.length; i++) {
		let al = awardMap.assignments[awards[i].awardId];
		awards[i].assignments = !al ? [] : al;
	}
	return awards;
}
var labelsAward = [t`Winner`, t`Second Place`, t`Third Place`, t`Runner Up`];
var labelsRobot = [t`Captain`, t`Partner`, t`2<sup>nd</sup> Pick`];
var labelsDean = [t`Congratulations`, ""];
var labelsTopRanked = [1, 2, 3, 4, 5, 6].map(ranking => t`Rank ${ranking}`);
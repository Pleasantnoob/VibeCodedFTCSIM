var teamData = {};
var eligibilityData = {}
var teamsAtEventTable;
var teamsInLeagueTable;
var teamsThatExistTable;
var teamsInRegionTable;
var teamsInParentTable;
var teamsThatAdvancedTable;
var eligibilityTable;
const EVENT = "EVENT";
const LEAGUE = "LEAGUE";
var mode = EVENT;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

let registrationMessage;

function renderTeamNumber(data, type, row) {
    if(type !== 'display') {
        return data
    }
    const paid = row.team ? row.team.paid : row.paid
    return data + (paid ? '' : '<span class="ml-2" data-toggle="tooltip" data-html="true" data-placement="right" title="' + registrationMessage + '">' +
        '<i class="fa fa-exclamation-triangle"></i>' +
        '</span>')
}

$().ready(function(){
    registrationMessage = t`This team's registration is not currently paid in <em>FIRST</em>'s systems. ` +
        (mode === EVENT ?
            t`Please confirm with your PDP that they are permitted to compete at this event.` :
            t`Please confirm with your PDP that they should be added to this league.`);
    if (window.location.href.indexOf("league") >= 0) {
        mode = LEAGUE;
    }
    $.ajax({
        url: "eligibility/",
        type: 'GET',
        success: function (data, textStatus, xhr) {
            // have this ready
            eligibilityData = data;
            console.log(eligibilityData);
        }
    });
    $("#advancementOverride").click(() => $("#editAdvancement").prop("disabled", false));
    $("#inspireOverride").click(() => $("#editInspire").prop("disabled", false));
    $.ajax({
        url: 'list/',
        type: 'GET',
        success: function (data,textStatus, xhr) {
            let parsed = data;
            let columns = [
                    {title: t`Number`, data: "team.number", className: "dt-center", render: renderTeamNumber},
                    {title: t`Short Name`, data: "team.shortName"},
                    {title: t`City`, data: "team.city", defaultContent: "", className: "dt-center", responsivePriority: 10007},
                    {title: t`State/Province`, data:"team.stateProv", className: "dt-center", responsivePriority: 10007},
                    {title: t`Country`, data: "team.country", className: "dt-center", responsivePriority: 10008}
                ]
            if (mode === EVENT && !dd) {
                columns.push({
                    title: t`Competing`,
                    data: "competing",
                    className: "text-center",
                    responsivePriority: 10007,
                    render: function (data, type, row) {
                        switch (data) {
                            case "FULL":
                                return t`Full`;
                            case "AWARDS_ONLY":
                                return t`Judging Only`;
                            case "NON_COMPETING":
                                return t`Not Competing`;
                        }
                    }
                });
            }
            columns.push({title: t`Rookie Year`, data: "team.rookieYear", className: "dt-center", responsivePriority: 10009});
            if (dd) {
                columns.push({title: "Division", data: "division", className: "dt-center", responsivePriority: 1006});
            }
            if(!teamListReadOnly) {
                columns.push({
                    data: null,
                    className: "center delete",
                    //<i class="fa fa-pencil-square" aria-hidden="true"></i>
                    defaultContent: ' <i class="fa fa-times-circle deleteRow" aria-hidden="true"></i>'
                });
            }
            teamsAtEventTable = $("#teamsAtEventData").DataTable({
                language: window.dataTableTranslations,
                data: parsed,
                columns: columns,
                paging: false,
                searching: false,
                responsive: true,
                rowCallback: (row) => {
                    $(row).find('[data-toggle="tooltip"]').tooltip();
                }
            });
            $('#teamsAtEventData tbody').on('click', 'tr', function (e) {
                var row = teamsAtEventTable.row($(this));
                if ($(e.target).hasClass("deleteRow")) {
                    remove(row.data().team.number);
                } else {
                    editable(row);
                }
            });
            getRegionTeamList();
            if (mode === EVENT && LEAGUE_CODE){
                getLeagueTeamList(LEAGUE_CODE);
            } else if (mode == LEAGUE && PARENT_LEAGUE_CODE) {
                getLeagueTeamList(PARENT_LEAGUE_CODE);
            }
            if (mode === EVENT && advancedTab) {
                getAdvancedTeamList();
            }
            if (division > 0) {
                getParentTeamList();
            }

        },
        error: function (xhr, status, error){
            // TODO indicate when they enter a non-existant team
            console.log("ERROR:"+xhr.responseText);
        }
    });
    if (dd) {
        $('#indTab').click();
    } else if((mode === EVENT && LEAGUE_CODE && !eventArchived) || (mode === LEAGUE && PARENT_LEAGUE_CODE)) {
        $('#leagueTab').click();
    }else {
        $('#indTab').click();
    }
    $('#hideSchoolsBox').click();
    $('#teamIn').keypress(function(e){
        if(e.keyCode==13)
            $('#indAdd').click();
    });

    $.ajax({
        url: '/countries/',
        type: 'GET',
        success: function (data,textStatus, xhr) {
            list = data;
            $("#countrySelect").empty(); // remove old options
            $.each(list, function(key, value) {
                $("#countrySelect").append($("<option></option>").attr("value", value).text(value));
            });

            if(country) {
                if (list.indexOf(country) >= 0) {
                    $("#countrySelect").val(country);
                } else {
                    if (list.indexOf("USA") >= 0) {
                        $("#countrySelect").val("USA");
                    }
                }
            } else {
                if (list.indexOf("USA") >= 0) {
                    $("#countrySelect").val("USA");
                }
            }

            updateStateList();

        },
        error: function(xhr, status, error){

        }
    });

    $("#countrySelect").change(updateStateList);
    $("#stateSelect").change(updateTeamListForState);
    $( document ).ready(function(){
        if(eventArchived) {
            var inputs = $(":input");
            inputs.prop("disabled", true);
            inputs.addClass("disabled");
        }
    });
});

function getField(name, flat) {
    return flat ? name : ("team." + name);
}

function createTeamListTable(div, data, flat = false) {
    let table = div.DataTable({
        language: window.dataTableTranslations,
        data: data,
        columns:[
            {
                data: "atEvent",
                className: "center added",
                //<i class="fa fa-pencil-square" aria-hidden="true"></i>
                render: function(data, type, row){return '<input type="checkbox" ' + (data ? "checked " : "") + (teamListReadOnly ? "disabled " : "") + '/>'}
            },
            {title: t`Number`, data: getField("number", flat), className: "dt-center", render: renderTeamNumber},
            {title: t`Short Name`, data: getField("shortName", flat)},
            {title: t`City`, data: getField("city", flat), defaultContent: "", className: "dt-center"},
            {title: t`State/Province`, data:getField("stateProv", flat), className: "dt-center"},
            {title: t`Country`, data: getField("country", flat), className: "dt-center"},
            {title: t`Rookie Year`, data: getField("rookieYear", flat), className: "dt-center"}
        ],
        retrieve: true,
        paging: false,
        searching: false,
        info: false,
        order: [[1, "asc"]],
        rowCallback: function(row, data, index) {
            $(row).find('[data-toggle="tooltip"]').tooltip();
            if (data.atEvent) {
                $(row).addClass("selected");
            }
        }
    });
    div.find('tbody').on('click', 'tr', function (e) {
        if(teamListReadOnly) {
            return;
        }
        let row = table.row($(this));
        if (row.data().atEvent) {
            remove(flat ? row.data().number : row.data().team.number);
        } else {
            add(flat ? row.data().number : row.data().team.number);
        }
    });
    return table;
}

/**
 * Updated the *passed* data with info about chich teams in this list are already in the event.
 */
function fillAtEvent(parsed) {
    let dat = teamsAtEventTable.rows().data();
    let teams = [];
    for (let i = 0; i < dat.length; i++) {
        teams.push(dat[i].team ? dat[i].team.number : dat[i].number);
    }
    for (let i = 0; i < parsed.length; i++) {
        parsed[i].atEvent = teams.indexOf(parsed[i].team ? parsed[i].team.number : parsed[i].number) > -1;
    }
    return parsed;
}

function getLeagueTeamList (leagueCode) {
    $.ajax({
        url: '/region/' + REGION_CODE + '/league/' + leagueCode + '/teams/list/',
        type: 'GET',
        success: function (data,textStatus, xhr) {
            parsed = fillAtEvent(data);
            teamsInLeagueTable = createTeamListTable($("#teamsInLeague"), parsed)
        },
        error: function(xhr, status, error){

        }
    });
}

function getParentTeamList() {
    $.ajax({
        url: 'list/parent', //needs to be separate b/c may not have permissions to directly ask parent event
        type: 'GET',
        success: function (data,textStatus, xhr) {
            parsed = fillAtEvent(data);
            teamsInParentTable = createTeamListTable($("#teamsInParent"), parsed)
        },
        error: function(xhr, status, error){

        }
    });
}

function getRegionTeamList() {
    $.ajax({
        url: '/region/' + REGION_CODE + '/teams/list',
        type: 'GET',
        success: function (data,textStatus, xhr) {
            let parsed = fillAtEvent(data)
            teamsInRegionTable = createTeamListTable($("#teamsInRegion"), parsed, true);
        },
        error: function(xhr, status, error){

        }
    });
}

function getAdvancedTeamList() {
    $.ajax({
        url: 'list/advanced',
        type: 'GET',
        success: function (data,textStatus, xhr) {
            let parsed = fillAtEvent(data)
            teamsThatAdvancedTable = createTeamListTable($("#teamsThatAdvanced"), parsed, true);
        },
        error: function(xhr, status, error){

        }
    });
}

function openTab(src, name) {
    // Declare all variables
    var i, tabcontent, tablinks;

    // Get all elements with class="tabcontent" and hide them
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Get all elements with class="tablinks" and remove the class "active"
    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Show the current tab, and add an "active" class to the button that opened the tab
    document.getElementById(name).style.display = "block";
    src.className += " active";
}

function addAllFromLeague() {
    let cbs =  $("#teamsInLeague tbody tr input:checkbox:not(:checked)");
    confirmDialog({
        label: t`Add All`,
        text: t`This will add ${cbs.length} teams to the event. Continue?`,
        buttonText: t`Add All`,
        onConfirm: () => addAll('league')
    })
}

function addAllFromAdvanced() {
    let cbs =  $("#teamsThatAdvanced tbody tr input:checkbox:not(:checked)");
    confirmDialog({
        label: t`Add All`,
        text: t`This will add ${cbs.length} teams to the event. Continue?`,
        buttonText: t`Add All`,
        onConfirm: () => addAll('advanced')
    })
}

function updateAddedStateForTable(table, team, added, parsed) {
    let rd = table.data();
    let flag = false;
    for (let i = 0; i < rd.length; i++) {
        if ((rd[i].team ? rd[i].team.number : rd[i].number) === team) {
            rd[i].atEvent = added;
            flag = true;
        }
    }
    if (added && !flag) {
        /* either a new team has been added to a child league, or a non-league team has been added to an event,
        or a new team was added directly to a division
         */
        if (mode === LEAGUE && table === teamsInLeagueTable) {
            // team has been added to parent league, update parent league table
            parsed.atEvent = true;
            rd.push(parsed);
            // TODO maybe show a toast notification somewhere stating this has occured
        } else if (division > 0 && table === teamsInParentTable) {
            // Team has been added directly to a division without first adding to main event, add entry in 'At Event' table
            parsed.atEvent = true;
            rd.push(parsed);
        } else {
            // non-league team has been added to event, flag them with a yellow triangle
        }
    }
    table.clear();
    table.rows.add(rd).draw();
}

// updates the background color of the rows in the tables that highlight added teams
function updateAddedState(team, added, parsed) {
    if (teamsInLeagueTable) {
        updateAddedStateForTable(teamsInLeagueTable, team, added, parsed);
    }
    if (teamsInRegionTable) {
        updateAddedStateForTable(teamsInRegionTable, team, added, parsed);
    }
    if (teamsThatAdvancedTable) {
        updateAddedStateForTable(teamsThatAdvancedTable, team, added, parsed);
    }
    if (teamsThatExistTable) {
        updateAddedStateForTable(teamsThatExistTable, team, added, parsed);
    }
    if (teamsInParentTable) {
        updateAddedStateForTable(teamsInParentTable, team, added, parsed);
    }
}

function addTeam(src){
    var num = parseInt(src.value);
    src.value = "";
    add(num);
}

function addAll(type) {
    destroyEligibility();
    $.ajax({
        url: `all/${type}`,
        type: 'POST',
        success: function (data,textStatus, xhr) {
            for (let part of data) {
                teamsAtEventTable.row.add(part).draw();
                updateAddedState(part.team.number, true, part);
            }
        },
        error: function (xhr, status, error){
            messageDialog({label: "Error", text: "Error adding all teams"});
            console.log("ERROR:"+xhr.responseText);
        }
    });
}

function add(num, force) {
    destroyEligibility();
    $.ajax({
        url: num + '/',
        type: 'POST',
        data: { force: force },
        success: function (data,textStatus, xhr) {
            if(xhr.status === 200 || xhr.status === 201){
                var parsed = data;
                teamsAtEventTable.row.add(parsed).draw();
                updateAddedState(num, true, parsed);
            }
        },
        error: function (xhr, status, error){
            if (xhr.status === 409) {
                messageDialog({ label: t`Could not add ${num}`, text: xhr.responseText });
            }
            if (xhr.status === 404) {
                messageDialog({ label: t`Could not add ${num}`, text: t`Team ${num} is not registered with FIRST` });
            }
            if(xhr.status === 400) {
                if(xhr.responseText === 'UNPAID') {
                    confirmDialog({ label: t`Registration Incomplete for Team ${num}`,
                        text: t`Team ${num}'s registration is not currently paid in <em>FIRST</em>'s systems. ` +
                            (mode === EVENT ?
                                t`Please confirm with your PDP that they are permitted to compete at this event.` :
                                t`Please confirm with your PDP that they should be added to this league.`),
                        onConfirm: () => add(num, true)})
                }
            }
            console.log("ERROR:"+xhr.responseText);
        }
    });
}

function getTeamListRow(team) {
    for(let i = 0; i < teamsAtEventTable.data().length; i++) {
        if (teamsAtEventTable.data()[i].team.number === team) {
            return teamsAtEventTable.row(i);
        }
    }
    return undefined;
}

function remove(team, confirm, capstoneConfirm = false){
    if (isCapstone && !capstoneConfirm) {
        confirmDialog({
            label: t`Team Removal`,
            text: `Are you sure you want to remove team ${team}?`,
            buttonText: t`Remove`,
            onConfirm: () => remove(team, confirm, true)
        })
        return;
    }
    destroyEligibility();
    $.ajax({
        url: team + "/" + (confirm ? "?confirm=true" : ""),
        type: 'DELETE',     
        success: function (data,textStatus, xhr) {
            // Remove row from table
            let row = getTeamListRow(team);
            teamsAtEventTable.row(row).remove().draw();
            updateAddedState(team, false);
        },
        error: function(xhr, status, error) {
            if (xhr.status === 409) {
                confirmDialog({
                    label: t`Team Removal`,
                    text: `<div class="alert alert-danger text-center" role="alert"><i class="fa fa-exclamation-triangle"></i>&nbsp;WARNING!&nbsp;<i class="fa fa-exclamation-triangle"></i></div>
                        ${t`Team ${team} has played matches. Are you sure you want to remove them?`}`,
                    buttonText: t`Remove`,
                    onConfirm: () => remove(team, true, capstoneConfirm)
                })
            } else {
                console.log("ERROR:" + error);
            }
        }
    });
}

async function editable(row) {
    let data = row.data();

    $(".rmv").prop("disabled", true);
    $(".editBtn").prop("disabled", true);
    $(".tablink").prop("disabled", true);
    $("#teamIn").prop("disabled", true);
    $("#indAdd").prop("disabled", true);

    
    
    $("#editNumber").text(data.team.number);
    $('#editBox').modal('show');
    $("#editBox .form-control").prop("disabled", false); //re-enable the inputs
    $("#editBox .form-control").attr("title", "");
    //var team = teamData[data];
    $("#editName").val(data.team.shortName);
    $("#editCity").val(data.team.city);
    $("#editState").val(data.team.stateProv);
    $("#editCountry").val(data.team.country);
    $("#editFullName").val(data.team.longName);
    $("#editSchool").val(data.team.school);
    $("#editRookie").val(data.team.rookieYear);
    $("#editRobot").val(data.team.robotName);
    $("#editDivision").val(data.division);
    $("#editAdvancement").val(data.advancement);
    $("#editInspire").val(data.inspireEligible == null ? null : (data.inspireEligible ? "ELIGIBLE" : "INELIGIBLE"));
    $("#editCompeting").val(data.competing);

    if (ADVANCES) {
        let localEligibilityData = eligibilityData;
        if (!localEligibilityData?.eligibility[data.team.number]) { // team was added after page load
            const s = Date.now();
            const resp = await fetch("eligibility/?team=" + data.team.number);
            localEligibilityData = await resp.json();
            console.log("ELIGIBILITY fetched in " + (Date.now() - s) + "ms:", localEligibilityData);
        }

        // advancement
        let ooR = localEligibilityData.outOfRegion.includes(data.team.number);
        // inspire - LT merge does not affect event played count
        let threeEvents = localEligibilityData.eligibility[data.team.number]?.filter(x => x.inRegion && !x.qtLtInspireMergeFlag).length > 2;
        let adv = ooR || threeEvents ? t`Ineligible` : t`Eligible`;
        let tt = ooR ? t`Out of Region` : (threeEvents ? t`3+ Plays` : "");
        if (localEligibilityData.advancement[data.team.number]?.length > 0) {
            adv = t`Already Advanced`;
            const detail = localEligibilityData.advancement[data.team.number][0];
            tt = detail.manualDate ? t`Manual` : detail.eventCode + " " + detail.advancement.criteria;
        }
        $("#autoAdvancement").text(adv).attr("title", tt);

        // inspire
        let inspireEvents = localEligibilityData.eligibility[data.team.number]?.filter(x => x.inRegion && x.published && x.inspire);
        let inspire = ooR || inspireEvents.length > 0 ? t`Ineligible` : t`Eligible`;
        tt = ooR ? t`Out of Region` : (inspireEvents.length > 0 ? t`Won at ${inspireEvents[0].event.code}` : "");
        $("#autoInspire").text(inspire).attr("title", tt);

        // TODO for RCMP [--> FCMP], disable override button if not GA.

        // warnings
        $("#eligibilityError,#eligibilityWarning").hide()
        if (eligibilityData.incompleteSiblings?.length > 0) {
            if (eligibilityData.incompleteSiblings.every(x => Date.parse(x.endDate) + MS_PER_DAY < Date.now())) {
                // if the end date of all the siblings has passed, show as an error.
                $("#unpublishedSiblings").text(eligibilityData.incompleteSiblings.map(x => `[${x.code}] ${x.name}`).join(","));
                $("#eligibilityError").show()
            } else {
                $("#eligibilityWarning").show();
            }
        }
    } else {
        if(isMeet) {
            $(".eventOnly").hide()
        } else {
            $(".advancingOnly").hide()
        }
    }

    $("#syncBtn").attr("onclick", "synchronize("+data.team.teamId+")");

    //For remote - disable team input buttons that we get from TARDIS. TODO once common, conditionally execute these few lines
    $("#editBox input,#editBox textarea,#editBox select").prop("disabled", true);
    if(!teamListReadOnly) {
        if (ADVANCES) {
            $(".override").prop("disabled", false);
        } else {
            // if meet, add tooltip
            $("label[for=editInspire], label[for=editCompeting], .override").attr("title", "Not applicable to this event type");
        }
        if (!isMeet) {
            $("#editCompeting").prop("disabled", false);
        } else {
            // if meet, add tooltip
            $("label[for=editCompeting], #editCompeting").attr("title", "Not applicable to League Meets");
        }
    }
    

    //$("#syncBtn").prop("hidden", !data.team.mismatched);
    $("#editSaveBtn").attr("onclick", REMOTE ? "saveRemote()" : "save()");
    if(!dd) {
        $("#editDivision").prop("disabled",true);
    } else {
        if (division === 0) {
            $("#editDivision").prop("disabled",false);
        } else {
            $("#editDivision").attr("title", t`Division cannot be changed here. Use the Event-Level Team Add.`);
        }
    }
}

function replace(){
    var data = $("#editNumber").text();
    console.log("Replacing Team "+data);
    $.ajax({
        url: "sync/"+data+"/",
        type: 'POST',
        contentType:'application/json',
        success: function (data, textStatus, xhr) {
            $('#editBox').modal('hide');
            $(".rmv").prop("disabled", false);
            $(".editBtn").prop("disabled", false);
            $(".tablink").prop("disabled", false);
            $("#teamIn").prop("disabled", false);
            $("#indAdd").prop("disabled", false);
            //We can guarentee mismatch is false, so we don't need to set it here.
            teamData[data.data.number+""] = data;
            var newRow = $(generateRow(data.data, data.advanced, data.division));
            $("#individual #row_"+data.data.number).replaceWith(newRow);
        },
        error: function(xhr, status, error){
            console.log(xhr);
        }
    });
}

function synchronize(data) {

    //If the sych requires a replacement, do not allow editing. Redirect the save button to replace()
    var isReplace = teamData[data+""].data.mismatched && teamData[data+""].data.wasAddedFromUi;
    if(isReplace) {
        $("#editSaveBtn").attr("onclick", "replace()");
        $("#editBox .form-control").prop("disabled", true); //cannot edit on full sync
        $("#editBox .form-control").attr("title", t`Cannot edit a replaced team until after synchronization saved`); //cannot edit on full sync
    }
    $.ajax({
        url: '/teams/team/'+data+"/",
        type: 'GET',
        contentType:'application/json',
        success: function (data, textStatus, xhr) {
            $("#editName").val(data.name);
            $("#editCity").val(data.city);
            $("#editState").val(data.state);
            $("#editCountry").val(data.country);
            $("#editFullName").val(data.school);
            if(isReplace){ //show that these will be overwritten
                $("#editSchool").val(data.schoolName);
            }
            $("#editRookie").val(data.rookie);
            if(isReplace){ //show that these will be overwritten
                $("#editRobot").val(data.robotName);
            }
        },
        error: function(xhr, status, error){
            console.log(xhr);
        }
    });

}

function hideEditBox() {
    $('#editBox').modal('hide');
    $(".rmv").prop("disabled", false);
    $(".editBtn").prop("disabled", false);
    $(".tablink").prop("disabled", false);
    $("#teamIn").prop("disabled", false);
    $("#indAdd").prop("disabled", false);
}

function saveRemote() {

    destroyEligibility();
    const newInspireOverride = $("#editInspire").val();
    const newPromoteOverride = $("#editPromote").val();
    var data = {
        advancement: $("#editAdvancement").val(),
        inspireEligible: newInspireOverride === "ELIGIBLE" ? true : (newInspireOverride === "INELIGIBLE" ? false : null),
        competing: $("#editCompeting").val(),
        division: $("#editDivision").val()
    }
    let team = $("#editNumber").text();
    $.ajax({
        url: $("#editNumber").text() + "/",
        type: 'PUT',
        data: data,
        success: function (returnData,textStatus, xhr) {
            console.log(returnData);
            teamsAtEventTable.row(getTeamListRow(parseInt(team))).remove();
            teamsAtEventTable.row.add(returnData).draw();
            hideEditBox();
        },
        error: function(xhr, status, error){
            console.error(xhr);
        }
    });

}

function save(){
    var teamDataLocal = {
        number:$("#editNumber").text(),
        name: $("#editName").val(),
        school: $("#editFullName").val(),
        schoolName: $("#editSchool").val(),
        city: $("#editCity").val(),
        state: $("#editState").val(),
        country: $("#editCountry").val(),
        rookie: $("#editRookie").val(),
        robotName: $("#editRobot").val()
    }
    if(isNaN(parseInt(teamDataLocal.rookie))){
        teamDataLocal.rookie = -1;
    }
    var t = {
        data: teamDataLocal,
        advancement: $("#editAdvancement").val(),
        division: $("#editDivision").val()
    };
    if(isNaN(parseInt(t.division))){
        t.division = 0;
    }
    $.ajax({
        url: '',
        type: 'POST',
        contentType:'application/json',
        data: JSON.stringify(t),
        success: function (returnData,textStatus, xhr) {
            hideEditBox();
            teamData[t.data.number].data.city = t.data.city;
            teamData[t.data.number].data.state = t.data.state;
            teamData[t.data.number].data.country = t.data.country;
            teamData[t.data.number].data.name = t.data.name;
            teamData[t.data.number].data.school = t.data.school;
            teamData[t.data.number].data.schoolName = t.data.schoolName;
            teamData[t.data.number].data.rookie = t.data.rookie;
            teamData[t.data.number].data.robotName = t.data.robotName;
            teamData[t.data.number].advanced = t.advanced;
            teamData[t.data.number].division = t.division;

            teamData[t.data.number].data.mismatched = eval(returnData);

            var newRow = $(generateRow(teamData[t.data.number].data, t.advancement, t.division));
            $("#individual #row_"+t.data.number).replaceWith(newRow);
        },
        error: function(xhr, status, error){
            console.log(xhr);
        }
    });
}

function cancel(){
    $('#editBox').modal('hide');
    $(".rmv").prop("disabled", false);
    $(".editBtn").prop("disabled", false);
    $(".tablink").prop("disabled", false);
    $("#teamIn").prop("disabled", false);
    $("#indAdd").prop("disabled", false);
}

function updateStateList() {
    o = {country: $("#countrySelect").val()};
    $.ajax({
        url: '/states/',
        type: 'GET',
        data: o,
        success: function (list,textStatus, xhr) {
            $("#stateSelect").empty(); // remove old options
            $.each(list, function(key, value) {
                $("#stateSelect").append($("<option></option>").attr("value", value).text(value));
            });        
            if(state){
                if (list.indexOf(state) >= 0) {
                    $("#stateSelect").val(state);
                }
            }
            updateTeamListForState();
        },
        error: function(xhr, status, error){
        
        }
    });
}

function updateTeamListForState() {
    o = {country: $("#countrySelect").val(), state:$("#stateSelect").val()};
    $.ajax({
        url: '/teams/location/',
        type: 'GET',
        data: o,
        success: function (list, textStatus, xhr) {
            let parsed = [];
            let dat = teamsAtEventTable.rows().data();
            let teams = [];
            for (let i = 0; i < dat.length; i++) {
                teams.push(dat[i].team.number);
            }
            for (var i = 0; i < list.length; i++) {
                parsed.push({team:list[i],atEvent:teams.indexOf(list[i].number) > -1});
            }
            if (teamsThatExistTable) {
                teamsThatExistTable.clear();
                teamsThatExistTable.rows.add(parsed).draw();
            } else {
                teamsThatExistTable = createTeamListTable($("#teamsThatExist"), parsed);
            }
        },
        error: function(xhr, status, error){
            console.log('Error getting teams');
        }
    });
}

function onTeamRowChecked(row) {
    if (!row.participant) {
        remove(row.number);
    } else {
        add(row.number);
    }
}

$(function () {
    $("#teamsThatExist").on('uncheck.bs.table check.bs.table', function (e, row, $element) {
        onTeamRowChecked(row);
    })
})

function updateTeamListForLeague() {
    $.ajax({
        url: './leagues/'+$("#leagueSelect").val()+'/',
        type: 'GET',
        success: function (list,textStatus, xhr) {
            for (var i = 0; i < list.length; i++) {
                if ($("#individual").find("#row_" + list[i].number).length) {
                    list[i].participant = true;
                }
            }
            $("#teamsLeagueThatExist").bootstrapTable('load', list);
        },
        error: function(xhr, status, error){
            console.log('Error getting league teams');
        }
    });
}

$(function () {
    $("#teamsLeagueThatExist").on('uncheck.bs.table check.bs.table', function (e, row, $element) {
        onTeamRowChecked(row);
    })
})


function updateTeamFromList(element) {
    var num = parseInt(element.id.substring(0, element.id.length - 8));
    if (element.checked) {
        add(num);
    } else {
        remove(num);
    }
}

function disableInputsAndShowProgress() {
  var inputs = $(":input");
  inputs.prop("disabled", true);
  inputs.addClass("disabled");
  $(".status").prop('hidden', false);
  $("#progress_bar").width('100%');
}

function runDivisionAssignment(alg) {
    let op = () => {
        disableInputsAndShowProgress();
        $.ajax({
            url: "divisions/" + alg,
            type: 'POST',
            success: function (data,textStatus, xhr) {
                window.location.reload(true);
            },
            error: function(xhr, status, error){
                window.alert(t`Error running the division assignment operation. This page will reload to ensure it is up to date.`);
                window.location.reload(true);
            }
        });
    }
    if (alg === 'CLEAR') {
        confirmDialog({
            label: t`Clear Division Assignments`,
            text: t`Are you sure you want to clear all division assignments?`,
            buttonText: t`Clear`,
            onConfirm: op
        });
    } else {
        if (alg === 'FIM') {
            let teamData = teamsAtEventTable.rows().data();
            let count = 0;
            for (let i = 0; i < teamData.length; i++) {
                if (teamData[i].division === 0) {
                    count++;
                }
            }
            if (count < 25) { // algorithm failed for in testing until ~20
                messageDialog({label: t`Assignment Error`, text: t`Not enough unassigned teams to run this assignment algorithm.`});
                return;
            }
        }
        op();
    }
}

function publishDivisions(pub) {
    $.ajax({
        url: "divisions/publish/" + pub,
        type: 'POST',
        success: function (data,textStatus, xhr) {
            let pubItems = $(".divPub");
            let notPubItems = $(".divNotPub");
            if (pub) {
                notPubItems.prop("hidden", true);
                pubItems.prop("hidden", false);
            } else {
                pubItems.prop("hidden", true);
                notPubItems.prop("hidden", false);
            }
        },
        error: function(xhr, status, error){
            console.log(error);
        }
    });
}

function destroyEligibility() {
    if (eligibilityTable) {
        eligibilityTable.destroy();
        $("#eligibilityTable").empty();
        $("#eligibilityReportHeader").prop("hidden", true);
        $("#eligibilityText").prop("hidden", true);
    }
}

function eligibility() {
    // refresh eligibility even though we already have a value of it
    $.ajax({
        url: "eligibility/",
        type: 'GET',
        success: function (data, textStatus, xhr) {
            eligibilityData = data;
            console.log(eligibilityData);
            let tabData = [];
            let partData = {};
            let teamData = teamsAtEventTable.rows().data()
            for (let i = 0; i < teamData.length; i++ ) {
                let x = teamData[i];
                partData[x.team.number + ""] = {advancementStatus: x.advancement, inspireStatus: x.inspireEligible};
            }
            for (k in data.eligibility) {
                let v = data.eligibility[k];
                let inspire = 0;
                let codes = [];
                let inspireCodes = [];
                let promoteCodes = [];
                for (let i = 0; i < v.length; i++) {
                    let insp = v[i].inspire ? 1 : 0;
                    inspire += insp;
                    if (insp) {
                        inspireCodes.push(v[i].event.code);
                    }
                    if (!v[i].qtLtInspireMergeFlag) { // do not count towards events played count
                        codes.push(v[i].event.code);
                    }
                }
                console.log(k, v);
                let part = partData[k + ""];
                let advanced = null;
                if (data.advancement[k]) {
                    if (data.advancement[k][0].manualDate && data.advancement[k][0].manualDate > EVENT_END_DATE) {
                        // dont show a future manual advancement
                    } else {
                        advanced = data.advancement[k][0];
                    }
                }
                tabData.push({
                    number: k,
                    eventCount: codes.length,
                    inspire: inspire,
                    eventCodes: codes.join(", "),
                    inspireCodes: inspireCodes.join(", "),
                    promoteCodes: promoteCodes.join(", "),
                    advancementStatus: part.advancementStatus,
                    inspireStatus: part.inspireStatus,
                    advanced: advanced,
                    outOfRegion: data.outOfRegion.includes(parseInt(k))
                });
            }

            eligibilityTable = $("#eligibilityTable").DataTable({
                language: window.dataTableTranslations,
                data: tabData,
                columns:[
                    {title: t`Team`, data:"number" , className: "dt-center"},
                    {title: t`Advancement`, data: "advanced" , className: "dt-center", render: (d) => `${d ? ("Advanced (" + (d.manualDate ? 'Manual' : d.eventCode) + ")" ) : ""}` },
                    {title: t`# Previous Events`, data: "eventCount", className: "dt-center", render: (d) => d },
                    {title: t`Inspire Wins`, data: "inspire", className: "dt-center", render: (d) => d }
                ],
                retrieve: true,
                paging: false,
                searching: false,
                order: [[0, "asc"]],
                rowCallback: function(row, data, index){
                    let cell = $(row).find('td:eq(1)');

                    if (data.advanced) {
                        cell.css('background-color', 'yellow');
                        const line2 = data.advanced.manualDate ? `Manually Advanced` : `Advanced from ${data.advanced.eventCode}${data.advanced.advancement.criteria.toLowerCase().includes("points") ? "" : ` as ${data.advanced.advancement.criteria}`}`;
                        cell.attr("title", line2);
                        if (data.advancementStatus === "ELIGIBLE") {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!\n${line2}`);
                        }
                    } else {
                        if (data.advancementStatus === "ALREADY_ADVANCED") {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden! Previous advancement could not be found. (Not configured?)`);
                        }
                    }
                    if (data.outOfRegion) {
                        cell.css('background-color', 'yellow');
                        cell.attr("title", "");
                        cell.text("Out Of Region");
                        if (data.advancementStatus === "ELIGIBLE") {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!`);
                        }
                    }

                    cell = $(row).find('td:eq(2)');
                    if (data.eventCount > 2) {
                        cell.css('background-color', 'yellow');
                        if (data.advancementStatus === "ELIGIBLE") {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!\nCompeted at: ${data.eventCodes}`);
                        } else {
                            cell.attr("title", t`Competed at: ${data.eventCodes}`);
                        }
                    } else {
                        if (data.advancementStatus === "INELIGIBLE" && !data.outOfRegion) {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!\n` + (data.eventCount > 0 ? t`Competed at: ${data.eventCodes}` : t`Has not competed.`));
                        } else {
                            cell.attr("title", data.eventCount > 0 ? t`Competed at: ${data.eventCodes}` : t`Has not competed.`);
                        }
                    }

                    cell = $(row).find('td:eq(3)');
                    if (data.inspire > 0) {
                        cell.css('background-color', 'yellow');
                        if (data.inspireStatus === true) {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!\nWon Inspire at: ${data.inspireCodes}`);
                        } else {
                            cell.attr("title", t`Won Inspire at: ${data.inspireCodes}`);
                        }
                    } else {
                        if (data.inspireStatus === false && !data.outOfRegion) {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!\nPrevious Inspire win could not be found.`);
                        } else {
                            cell.attr("title", data.outOfRegion ? t`Out of Region` : t`Has not won Inspire`);
                        }
                    }
                    if (data.outOfRegion) {
                        cell.css('background-color', 'yellow');
                        cell.text(t`Out of Region`);
                        if (data.inspireStatus === true) {
                            cell.append($("<i/>").addClass("fa fa-exclamation-triangle"));
                            cell.attr("title", t`Overridden!`);
                        }
                    }
                },
                initComplete: (settings, json) => {
                    if (!FF_ADVANCEMENT) {
                        $("#eligibilityTable").DataTable().columns(1).visible(false);
                    }
                }
            });
            $("#eligibilityReportHeader,#eligibilityText").prop("hidden", false);
            $("#eligibilityReportHeader")[0].scrollIntoView();

            $("#eligibilityReportError,#eligibilityReportWarning").hide()
            if (data.incompleteSiblings?.length > 0) {
                if (data.incompleteSiblings.every(x => Date.parse(x.endDate) + MS_PER_DAY < Date.now())) {
                    // if the end date of all the siblings has passed, show as an error.
                    $("#unpublishedSiblingsReport").text(data.incompleteSiblings.map(x => `[${x.code}] ${x.name}`).join(","));
                    $("#eligibilityReportError").show()
                } else {
                    $("#eligibilityReportWarning").show();
                }
            }
        },
        error: function(xhr, status, error){
            console.log("Error fetching eligibility");

        }
    });
}
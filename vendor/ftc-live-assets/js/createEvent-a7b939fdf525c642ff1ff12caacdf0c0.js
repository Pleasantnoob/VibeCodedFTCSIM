function keySubmit(e) {
    if (e.which == 13) { //enter
        submit();
    }
}
let confirmedCreation = false;
$().ready(function() {
    $("#loading").hide();
    $("input").keypress(keySubmit);
    initDivisionFields();
    $("#divisions").hide();
    if(window.eventArchived) {
        var inputs = $(":input");
        inputs.prop("disabled", true);
        inputs.addClass("disabled");
    }
    const createWarningModal = $("#createWarningModal");
    createWarningModal.on("hide.bs.modal", function () {
        if(confirmedCreation) {
            return;
        }
        if(history.length > 1) {
            history.back()
        } else {
            window.location.replace("/setup/offline/")
        }
    })
    if(!window.eventCode) {
        createWarningModal.modal("show")
    }
});

function dismissCreateWarningModal() {
    confirmedCreation = true;
    $("#createWarningModal").modal("hide");
}

var numDivisions = 2;
function initDivisionFields() {
    $("#divisions").empty();
    for (var i = 1; i < numDivisions + 1; i++) { //divisions are one indexed
        var division = $("#divisionTemplate").clone();

        division.find("#divisionNameInput").attr("id", "divisionNameInput" + i)
        var divisionNameLabel = division.find("#divisionNameLabel");
        divisionNameLabel.attr("id", "divisionNameLabel" + i);
        divisionNameLabel.attr("for", "divisionNameInput" + i);
        divisionNameLabel.text(t`Division ${i} Name:`);

        division.find("#divisionAbbrevInput").attr("id", "divisionAbbrevInput" + i)
        var divisionAbbrevLabel = division.find("#divisionAbbrevLabel");
        divisionAbbrevLabel.attr("id", "divisionAbbrevLabel" + i);
        divisionAbbrevLabel.attr("for", "divisionAbbrevInput" + i);
        divisionAbbrevLabel.text(t`Division ${i} Abbreviation (max 4 characters):`)
        division.attr("id", "division" + i);
        division.removeClass("d-none");
        $("#divisions").append(division);
    }
}
function changed() {
    if (!$("#endDatePicker").val()) {
        $("#endDatePicker").val($("#startDatePicker").val());
        $("#endDatePicker").removeClass("red");
    }
}

function removeRed(obj) {
    $(obj.target).removeClass("red");
}
var waitingForSubmit = false;
function getObj() {
    $("#error").empty();
    obj = {};
    obj.eventCode = $("#eventCodeInput").val();
    obj.eventName = $("#eventNameInput").val();
    obj.eventType = $("#eventTypeInput").val();
    if(window.fmsCode.length > 0) {
        obj.fmsCode = window.fmsCode
    }
    obj.region = $("#eventRegionInput").val();
    obj.eventStartDate = $("#startDatePicker").val();
    obj.eventEndDate = $("#endDatePicker").val();
    obj.eventFieldNumber = $("#fieldNumberInput").val();
    obj.dualDivision = $("#dualDivisionCheck").prop("checked");
    obj.quadDivision = $("#divisionCount4").prop("checked");
    obj.sixDivision = $("#divisionCount6").prop("checked");
    obj.eventLogo = $("#eventLogoInput").val();
    obj.interdivisionName = $("#interdivisionNameInput").val();
    obj.matchPrefixLogo = $("#matchPrefixLogoInput").val();
    if (obj.dualDivision) {
        obj.divisionNames = [];
        obj.divisionAbbrevs = [];
        for (var i = 1; i < (obj.sixDivision ? 6 : (obj.quadDivision ? 4 : 2)) + 1; i++) {
            obj.divisionNames.push($("#divisionNameInput" + i).val());
            obj.divisionAbbrevs.push($("#divisionAbbrevInput" + i).val());
        }
        //obj.divisionNames = JSON.stringify(obj.divisionNames);
        //obj.divisionAbbrevs = JSON.stringify(obj.divisionAbbrevs);
    }
    var bad = false;
    if (obj.eventCode == "" || !/^[a-z_0-9]*$/.test(obj.eventCode) || 'global' === obj.eventCode || 'server' === obj.eventCode) {
        $("#eventCodeInput").addClass("red");
        $("#eventCodeInput").change(removeRed);
        if (obj.eventCode == "") {
            $("#error").append(t`Event code cannot be empty.` + '<br>');
        } else if (!/^[a-z_0-9]*$/.test(obj.eventCode)) {
            $("#error").append(t`Event code must only contain a-z, 0-9, and underscore.` + '<br>');
        } else {
            $("#error").append(t`Event code cannot be: ${obj.eventCode}.` + '<br>');
        }
        bad = true;
    }
    var startDateText = new Date(obj.eventStartDate);
    var startDateActual = new Date($("#startDatePicker").val());
    var goodStart = (startDateText <= startDateActual && startDateActual <= startDateText);
    if (obj.eventStartDate == "" || !goodStart) {
        $("#startDatePicker").addClass("red");
        $("#startDatePicker").change(removeRed);
        if (obj.eventStartDate == "") {
            $("#error").append(t`Must specify start date.` + '<br>');
        } else if (!goodStart) {
            $("#error").append(t`Start date is not in valid format.` + '<br>');
        }
        bad = true;
    }
    var endDateText = new Date(obj.eventEndDate);
    var endDateActual = new Date($("#endDatePicker").val());
    var goodEnd = (startDateText <= startDateActual && startDateActual <= startDateText);
    if (obj.eventEndDate == "") {
        $("#endDatePicker").addClass("red");
        $("#endDatePicker").change(removeRed);
        if (obj.eventEndDate == "") {
            $("#error").append(t`Must specify end date.` + '<br>');
        } else if (!goodEnd) {
            $("#error").append(t`End date is not in valid format.` + '<br>');
        }
        bad = true;
    }
    if (goodEnd && goodStart && endDateActual < startDateActual) {
        $("#endDatePicker").addClass("red");
        $("#endDatePicker").change(removeRed);
        $("#error").append(t`End date cannot be before start date.` + '<br>');
        bad = true;
    }
    if (!window.dualDivisionChild && obj.region == null) {
        $("#eventRegionInput").addClass("red");
        $("#eventRegionInput").change(removeRed);
        $("#error").append(t`Must specify region.` + '<br>');
        bad = true;
    }
    if(window.dualDivisionChild) {
        obj.region = window.region;
    }
    if (obj.eventFieldNumber == "" || isNaN(obj.eventFieldNumber)) {
        $("#fieldNumberInput").addClass("red");
        $("#fieldNumberInput").change(removeRed);
        $("#error").append(t`Must specify valid field count.` + '<br>');
        bad = true;
    }
    if (obj.eventFieldNumber <= 0) {
        $("#fieldNumberInput").addClass("red");
        $("#fieldNumberInput").change(removeRed);
        $("#error").append(t`Field count must be positive.` + '<br>');
        bad = true;
    }
    if (obj.dualDivision && obj.eventType == 1 /*league meet*/) {
        $("#dualDivisionCheck").addClass("red");
        $("#dualDivisionCheck").change(removeRed);
        $("#error").append(t`Cannot have a Dual-Division League Meet.` + '<br>');
        bad = true;
    }
    if (!window.eventCode && obj.dualDivision) {
        var abbrev;
        var no = false;
        for (abbrev = 1; abbrev <= obj.divisionAbbrevs.length; abbrev++) {
            if (obj.divisionAbbrevs[abbrev - 1].length == 0) {
                $("#divisionAbbrevInput" + abbrev).addClass("red");
                $("#divisionAbbrevInput" + abbrev).change(removeRed);
                no = true;
            }
        }
        if (no) {
            $("#error").append(t`Must specify all division abbreviations.` + '<br>');
            bad = true;
        }

        var name;
        no = false;
        for (name = 1; name <= obj.divisionNames.length; name++) {
            if (obj.divisionNames[name - 1].length == 0) {
                $("#divisionNameInput" + name).addClass("red");
                $("#divisionNameInput" + name).change(removeRed);
                no = true;
            }
        }
        if (no) {
            $("#error").append(t`Must specify all division names.` + '<br>');
            bad = true;
        }
    }
    return bad ? null : obj;
}
function submit() {
    if (waitingForSubmit) {
        return;
    }
    waitingForSubmit = true;
    obj = getObj();
    if (obj == null) {
        waitingForSubmit = false;
        return;
    }
    $("#loading").show();
    $.ajax({
        url: window.eventCode ? "." : "/create/event/",
        type: window.eventCode ? "PUT" : "POST",
        data: obj,
            success: function (data) {
            //we good
            console.log("we good");
            window.location.replace('/event/' + data + '/dashboard/');
            waitingForSubmit = false;
        },
        error: function (xhr, textStatus, errorThrown) {
            $("#error").append(xhr.responseText + "<br>");
            if(xhr.status == 409) {
                $("#eventCodeInput").addClass("red");
                $("#eventCodeInput").change(removeRed);
            }
            $("#loading").hide();
            waitingForSubmit = false;
    }});
}
function checkFieldCount() {
    /*
        if ($("#eventTypeInput option:checked").val() == 1) { //this is a League Meet, can only have 1 field
            $("#fieldNumberInput").prop("disabled", true);
            $("#fieldNumberInput").val(1);
        } else {
            $("#fieldNumberInput").prop("disabled", false);
        }
        */
}
function setFieldVisible(cb) {
    if (cb.checked) {
        $("#fieldGroup").hide();
        $("#divisions").show();
        if ($("#eventTypeInput option:checked").val() == 6) {
            $("#quadDivision,#sixDivision").show();
        }
    } else {
        $("#fieldGroup").show();
        $("#divisions").hide();
        $("#quadDivision,#sixDivision").hide();
    }
}

function setDivisionCount(count) {
    numDivisions = count;
    initDivisionFields();
}
function checkDualDivision() {
    if ($("#eventTypeInput option:checked").val() == 1) { //this is a League Meet, cannot be dual division
        if ($("#dualDivisionCheck").prop("checked")) {
            $("#fieldGroup").show();
            $("#divisions").hide();
            $("#quadDivision,#sixDivision").hide();
        }
        $("#dualDivisionCheck").prop("disabled", true);
        $("#dualDivisionCheck").prop("checked", false);
    } else {
        if ($("#dualDivisionCheck").prop("disabled")) {
            $("#fieldGroup").show();
            $("#divisions").hide();
        }
        $("#dualDivisionCheck").prop("disabled", false);
        if($("#eventTypeInput option:checked").val() == 6 && $("#dualDivisionCheck").prop("checked")) {
            $("#quadDivision,#sixDivision").show();
        } else {
            $("#quadDivision,#sixDivision").hide();
        }
    }
}

function updateLogoPreview() {
    const eventLogoInput = document.getElementById("eventLogoInput");
    const matchPrefixLogoInput = document.getElementById("matchPrefixLogoInput");
    if (eventLogoInput) {
        document.getElementById("eventLogoPreview").innerHTML = eventLogoInput.value;
    }
    if(matchPrefixLogoInput) {
        document.getElementById("matchPrefixLogoPreview").innerHTML = matchPrefixLogoInput.value;
    }
}
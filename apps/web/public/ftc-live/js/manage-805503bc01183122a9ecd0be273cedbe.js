function onSelectHide(){
    $("#hideVerify").prop("hidden", false);
    $("#hideMsg").prop("hidden", true);
    $("#hideBtns").prop("hidden", false);
}
function reload(force = false) {
    var selected = $("#hideList").val();
    $("#hideMsg").prop("hidden", false);
    $("#hideMsg").text(t`Reloading ${selected}... (This will take a few seconds)`);
    fetch(`reload/${selected}/?force=${force}`, {method: 'POST'}).then(r => {
        if (!r.ok) {
            if (r.status === 409) {
                $("#hideMsg").prop("hidden", true);
                r.text().then(match => {
                    confirmDialog({
                        label: t`Confirm Reload`,
                        text: t`Match ${match} is actively running! Reloading may have unknown effects on the match. Scores may need to be reentered. Are you sure you want to continue?`,
                        buttonText: t`Reload`,
                        onConfirm: () => reload(true)
                    });
                });
                return;
            }
            throw new Error(r.statusText);
        }
        $("#hideMsg").prop("hidden", false);
        $("#hideMsg").text(t`Reload of ${selected} complete!`);
    }).catch(e => {
        $("#verifyErr").prop("hidden", false);
        $("#verifyErr").text(t`Reload Failed: ` + e);
    });
}
function hide(){
    var selected = $("#hideList").val();
    const ver = prompt(t`Enter the event code to confirm hiding event ${selected}:`, "");
    if (ver === "") { // cancelled
        return;
    }
    //var ver = $("#hideInput").val();
    if (ver === selected) {
        //perform the hide
        fetch(`hide/${selected}/`, {method: 'POST'}).then(r => {
            if (!r.ok) throw new Error(r.statusText);
            $("#hideMsg").prop("hidden", false);
            $("#hideMsg").text(t`Hid event: ${selected}`);
            $("#hideVerify").prop("hidden", false);
            $("#hideInput").val("");
            $("#hideList").val("0");
            $(`#hideList option[value='${selected}']`).remove();
        }).catch(e => {
            $("#verifyErr").prop("hidden", false);
            $("#verifyErr").text(t`Hide Failed: ` + e);
        });
    } else {
        //display error message
        $("#verifyErr").prop("hidden", false);
        $("#verifyErr").text(t`Verification Failed: Event code does not match`);
    }
}

function uploadArchive(){
    var files = document.getElementById("archiveFile").files;
    var formData = new FormData();
    formData.append("file",files[0], files[0].name);
    var stat = $("#importEventStatus");
    stat.text(t`Importing event...`);
    stat.removeClass("verifyErr");
    $.ajax({
        url : 'import/',
        type : 'POST',
        data : formData,
        processData: false,  // tell jQuery not to process the data
        contentType: false,  // tell jQuery not to set contentType
        success : function(data) {
            // preview the logo using the name we got back
            var stat = $("#importEventStatus");
            stat.text(t`Event added!`);
            stat.removeClass("verifyErr");
        },
        error : function(xhr, textStatus, error){
            var stat = $("#importEventStatus");
            stat.text(xhr.status === 400 ? xhr.responseText : t`Import Failed.`);
            stat.addClass("verifyErr");
        }
    });
}

function refreshIP() {
    $("#refreshIPStatus").text(t`Refreshing IP Address... Page will refresh when done.`)
    $.ajax({
        url : 'refreship/',
        type : 'POST',
        processData: false,  // tell jQuery not to process the data
        contentType: false,  // tell jQuery not to set contentType
        success : function(data) {
            window.location.reload();
        },
        error : function(xhr, textStatus, error){

        }
    });
}

function overrideIp() {
    fetch('overrideip/', {method: 'POST', body:$(".ipRadio:checked").val()}).then(() => window.location.reload());
}


function updateStatus(data){
    const msg = JSON.parse(data);

    if(msg.progress) {
        $("#ddProg").attr("aria-valuenow",msg.progress * 100);
        $("#ddProg").css("width", msg.progress * 100 + "%");
        $("#ddStatus").html(t`Downloading update...`);
    } else if(msg.complete) {
        $("#ddProg").attr("aria-valuenow",100);
        $("#ddProg").css("width", "100%");
        $("#ddStatus").html(t`Data download complete!`);
    } else if(msg.error) {
        $("#ddStatus").html(t`Data download failed: ` + msg.error);
    }
}

function dataDownload(){
    $("#ddp").prop("hidden", true);
    $("#ddProg").removeClass("err");
    $("#ddStatus").html(t`Connecting to <i>FIRST</i> HQ...`);
    $.ajax({
        url : 'download/',
        type : 'POST',
        processData: false,  // tell jQuery not to process the data
        contentType: false,  // tell jQuery not to set contentType
        success : function(data, status, xhr) {
            if(xhr.status == 304){
                $("#ddStatus").html(t`Up to date. (< 5 minutes since last update).`);
                return;
            }
            //show progress bar.
            $("#ddp").prop("hidden", false);
            $("#ddStatus").html(t`Checking for updates...`);
            var ws = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/stream/manage/download/status/`);
            ws.onmessage = function(evt) {
                updateStatus(evt.data);
            };
        },
        error : function(xhr, textStatus, error){
            //TODO message, check 409 vs 500
            if(xhr.status == 409){
                $("#ddp").prop("hidden", false);
                $("#ddStatus").html(t`Checking for updates...`);
                var ws = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/stream/manage/download/status/`);
                ws.onmessage = function(evt) {
                    updateStatus(evt.data);
                };
            }else if(xhr.status == 500){
                $("#ddStatus").html(`<font color='red'>${t`Error connecting to <i>FIRST</i>!`}</font>`);
            }
        }
    });
}

function checkVersion(){
    $.ajax({
        url : 'version/',
        type : 'GET',
        success : function(data) {
            $("#versionStatus").html(data);
        }, error: function(xhr, ts, er){
            $("#versionStatus").html(`<font color='red'>${t`Error checking updates!`}</font>`);
        }
    });
}
function fileSelect(e){
    var file = e.files[0].name;
    document.getElementById('uploadArchive').disabled = (file.length == 0);
    $("#fileName").text(file);
}
function toggle(key) {
    $("#button"+key).addClass("disabled");
    obj = {};
    obj.key = key;
    $.ajax({
        url : 'togglekey/',
        type : 'POST',
        data : obj,
        success : function(data) {
            var id = $("#status"+key);
            var button = $("#button"+key);
            if (id.text() === "true") {
                id.text("false");
                button.text(t`Activate`);
            } else {
                id.text("true");
                button.text(t`Deactivate`);
            }
            button.removeClass("disabled");
        }, error: function(xhr, ts, er){
            $("#button"+key).removeClass("disabled");
        }
    });
}
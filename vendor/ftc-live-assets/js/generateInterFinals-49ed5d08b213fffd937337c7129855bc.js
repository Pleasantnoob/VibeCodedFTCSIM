function uploadDivision(div, ovr){
    var files = document.getElementById("divisionFile"+div).files;
    var formData = new FormData();
    formData.append("file",files[0], files[0].name);
    $.ajax({
        url : 'import/'+div+"/"+ovr+"/",
        type : 'POST',
        data : formData,
        processData: false,  // tell jQuery not to process the data
        contentType: false,  // tell jQuery not to set contentType
        success : function(data) {
            window.location.reload(false);
        },
        error : function(xhr, textStatus, error){
            var msg = xhr.responseText.split(",");

            var res = $("#divisionPath"+div);
            res.empty();
            var d2 = $("<div/>");
            d2.text(t`Division import failed:`);
            var list = $("<ul/>");
            for(var i = 0; i < msg.length; i++){
                list.append(($("<li>").text(msg[i])));
            }
            d2.append(list);
            if(xhr.status == 409){
                d2.append($(`<div class='text-center'><button onclick='uploadDivision(${div}, true)'>${t`Overwrite`})</button></div>`));
            }
            res.append(d2);
        }
    });
}
async function submit() {
    const startTime = await promptDialog({
        label: 'Playoff Match Start Time',
        text: 'Enter the time the first playoff match is expected to start',
        customInputParams: {
            type: 'datetime-local',
            step: 300
        },
        defaultValue: new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 15 * 60000).toISOString().slice(0, 16),
        // Once temporal is broadly available in browsers and doesn't require a polyfill...
        //Temporal.Now.plainDateTimeISO().add({minutes: 15}).round({ roundingIncrement: 5, roundingMode: 'ceil', smallestUnit: 'minute' }).toString().slice(0, 16),
        buttonText: 'Submit'
    })
    if(!startTime) {
        return;
    }

    fetch('.', {method: 'POST', body: new URLSearchParams({startTime})}).then(r => {
        if(r.ok) {
            window.location.href = '..';
        } else {
            messageDialog({label: t`Error`, text: t`An error occurred generating matches.`});
        }
    });
}
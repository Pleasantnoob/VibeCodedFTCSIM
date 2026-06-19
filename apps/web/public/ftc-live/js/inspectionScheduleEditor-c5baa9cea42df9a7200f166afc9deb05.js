/* Copyright (c) 2018 FIRST, Thomas Barnette, George Marchant, and Trey Woodlief. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted (subject to the limitations in the disclaimer below) provided that
 * the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list
 * of conditions and the following disclaimer.
 *
 * Redistributions in binary form must reproduce the above copyright notice, this
 * list of conditions and the following disclaimer in the documentation and/or
 * other materials provided with the distribution.
 *
 * Neither the name of FIRST nor the names of its contributors may be used to endorse or
 * promote products derived from this software without specific prior written permission.
 *
 * NO EXPRESS OR IMPLIED LICENSES TO ANY PARTY'S PATENT RIGHTS ARE GRANTED BY THIS
 * LICENSE. THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

function uploadSchedule(){
	var files = document.getElementById("filePath").files;
	var formData = new FormData();
	formData.append("file",files[0], files[0].name);
	
	$.ajax({
       url : 'import/',
       type : 'POST',
       data : formData,
       processData: false,  // tell jQuery not to process the data
       contentType: false,  // tell jQuery not to set contentType
       success : function(data) {
    	   window.location.reload();
       },
       error : function(xhr, textStatus, error){
		  $("#schedule-error-msg").html(`<h4>${t`Error Importing Schedule`}</h4>${t`Schedule has not been updated. Please correct these errors and try again:`}<br>` + xhr.responseText);
		}
	});
}

function toDateString(date) {
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000 ))
    .toISOString()
    .split("T")[0];
}

var bindStatus;
var removeStatus;
$(document).ready(function() {
	$("#filePath").change(function() {
		$("#filePathDisplay").text(document.getElementById("filePath").files[0].name);
	});
    let zpad = (t) => t < 10 ? "0" + t : t;
    let today = eventStart;
    today.setHours(8,0);
    $('#day-input').val(toDateString(today));
    $('#start-time-input').val(zpad(today.getHours()) + ":" + zpad(today.getMinutes()));
    $('#end-time-input').val(zpad(today.getHours() + 1) + ":" + zpad(today.getMinutes()));

    // setup default periods and activities
    var periods = [{
        date: toDateString(today),
        startTime: ('0' + today.getHours()).slice(-2) + ":" +  ('0' + today.getMinutes()).slice(-2),
        endTime: ('0' + Math.min((today.getHours() + 3), 23)).slice(-2) + ":" +  ('0' + today.getMinutes()).slice(-2)
    }];
    var activities = [
        {
            name: t`Judging`,
            duration: "15",
            stations: "3",
            bindings: []
        },
        {
            name: t`Inspection`,
            duration: "15",
            stations: "3",
            bindings: []
        }
    ];
    // check to see if there are preexisting blocks
    $.ajax({
        url: "./form/",
        type: "GET",
        success: function(blocks){
            if (Array.isArray(blocks) && blocks.length) {
                if (blocks[0].length) {
                    periods = blocks[0];
                }
                if (blocks[1].length) {
                    activities = blocks[1];
                }
                if(blocks[2]){
                	formTypes = blocks[2];
                }
            }
        },
        complete: function() {
            saveScheduleData(); // save updated data
            // generate all blocks into the DOM
            for (i = 0; i < periods.length; i++) {
                appendPeriod(i);
            }
            for (i = 0; i < activities.length; i++) {
                appendActivity(i);
            }
            for(i = 0; i < activities.length; i++){
	            var item = $("#activity-" + i);
	            console.log(item);
	            //TODO: populate with options based on status tracking config
	            //TODO remove all used ones BEFORE first select.
	            var select = item.find(".activity-status-select");
	            for(var x = 0; x < formTypes.length; x++){        	
	            	select.append($("<option value='"+formTypes[x].code+"' class='statusOption'>"+formTypes[x].name+"</option>"))
	            }
            }
            if ($("#eventArchived").length) {
    	        var inputs = $(":input,label");
    	        inputs.prop("disabled", true);
    	        inputs.addClass("disabled");
            }
        }
    });

    // load schedule if one exists
    $.ajax({
        url: "../../inspection_schedule/raw/",
        type: "GET",
        success: function(data){
            if(!data){
                return;
            }
            parseTableSchedule(data.teamSchedules);
            parseGridSchedule(data.teamSchedules);
        }
    });

    // hide loading bar
    $('#loading').hide('fast');

    // handle buttons clicks
    $('#add-period').click(function() {
        periods.push({
            date: $('#day-input').val(),
            startTime: $('#start-time-input').val(),
            endTime: $('#end-time-input').val()
        });
        saveScheduleData();
        appendPeriod(periods.length - 1);
    });

    $('#add-activity').click(function() {
        activities.push({
            name: $('#name-input').val(),
            duration: $('#duration-input').val(),
            stations: $('#stations-input').val(),
            bindings: []
        });
        saveScheduleData();
        appendActivity(activities.length - 1);
        
        var index = activities.length - 1;
        var item = $("#activity-" + index);
        if(index > 0){
        	//copy from one below
        	var prev = $("#activity-" + (index-1));
        	var prevSelect = prev.find(".activity-status-select");
        	var select = item.find(".activity-status-select");
        	var children = prevSelect.children();
        	for(var x = 0; x < children.length; x++){
        		select.append($(children[x]).clone());
        	}
        } else{//add all	 (This code never runs, if all are deleted it subs in defaults)       
	        var select = item.find(".activity-status-select");
	        for(var x = 0; x < formTypes.length; x++){        	
	        	select.append($("<option value='"+formTypes[x].code+"' class='statusOption'>"+formTypes[x].name+"</option>"))
	        }
        }

    });

    $('#generate-btn').click(function() {
        generateSchedule();
    });
    
    $('#export-btn').click(function() {
    	window.open('export/');
    });
    
    $('#import-btn').click(function() {
    	uploadSchedule();
    });

    // event handlers for Time Periods to delete items and update inplace edits
    $('#time-periods-items').on ('click', '.delete', function() {
        var id = $(this).closest('tr').attr("id");
        periods.splice(id.substring(id.lastIndexOf('-') + 1), 1);
        saveScheduleData();
        $('#' + id).remove();
    });
    $('#time-periods-items').on ('change', '.period-date', function() {
        var id = $(this).closest('tr').attr("id");
        periods[id.substring(id.lastIndexOf('-') + 1)].date = $(this).val();
        saveScheduleData();
    });
    $('#time-periods-items').on ('change', '.period-start', function() {
        var id = $(this).closest('tr').attr("id");
        periods[id.substring(id.lastIndexOf('-') + 1)].startTime = $(this).val();
        saveScheduleData();
    });
    $('#time-periods-items').on ('change', '.period-end', function() {
        var id = $(this).closest('tr').attr("id");
        periods[id.substring(id.lastIndexOf('-') + 1)].endTime = $(this).val();
        saveScheduleData();
    });

    // event handlers for Activities to delete items and update inplace edits
    $('#activities-items').on ('click', '.delete', function() {
        var id = $(this).closest('tr').attr("id");
        activities.splice(id.substring(id.lastIndexOf('-') + 1), 1);
        saveScheduleData();
        $('#' + id).remove();
    });
    $('#activities-items').on ('change', '.activity-name', function() {
        var id = $(this).closest('tr').attr("id");
        activities[id.substring(id.lastIndexOf('-') + 1)].name = $(this).val();
        saveScheduleData();
    });
    $('#activities-items').on ('change', '.activity-duration', function() {
        var id = $(this).closest('tr').attr("id");
        activities[id.substring(id.lastIndexOf('-') + 1)].duration = $(this).val();
        saveScheduleData();
    });
    $('#activities-items').on ('change', '.activity-stations', function() {
        var id = $(this).closest('tr').attr("id");
        activities[id.substring(id.lastIndexOf('-') + 1)].stations = $(this).val();
        saveScheduleData();
    });
    $('#activities-items').on ('click', '.activity-stations-name-edit', function() {
      var id = $(this).closest('tr').attr("id");
      const index = id.substring(id.lastIndexOf('-') + 1);
      const data = activities[index];
      $("#station-name-category").text(data.name)
      const body = $("#edit-station-names .modal-body")
      body.empty()
      for(let i = 0; i < data.stations; i++) {
        body.append(`
          <div class="form-group">
            <label for="station-${i}">${t`Station`} ${i + 1}</label>
            <input type="text" class="form-control" id="station-${i}" value="${data.stationNames && data.stationNames[i] || (i + 1)}">
          </div>
        `)
      }
      const editNamesModal = $("#edit-station-names")
      editNamesModal.data("activity_index", index);
      editNamesModal.modal("show");
    });
    $("#save-station-names").on('click', function() {
      const editNamesModal = $("#edit-station-names")
      const index = editNamesModal.data("activity_index");
      const data = activities[index];
      data.stationNames = [];
      for(let i = 0; i < data.stations; i++) {
        data.stationNames.push($("#station-" + i).val());
      }
      saveScheduleData();
      editNamesModal.modal("hide");
    })
    
    
    
    bindStatus = function(src){
    	src = $(src);
		var stat = $("#status-div-template").clone();
		stat.removeClass("temp");
		let type = undefined;
		for(var i = 0; i < formTypes.length; i++){
			if(formTypes[i].code == src.val()){
				type = formTypes[i];
				break;
			}
		}
	    stat.find(".statusText").text(type.abbrev);
	    stat.find(".statusText").attr("name",type.code);
	    stat.find(".statusText").attr("title",type.name);
		var status = src.parent().parent().find(".activity-status");
		status.append(stat);
		$(".statusOption[value='"+type.code+"']").remove();
		src.val("");
		
		
	    var id = $(src).closest('tr').attr("id");
	    var bound = status.children();
	    var bindings = [];
	    for(var i = 0; i < bound.length; i++){
	    	bindings.push($(bound[i]).children(".statusText").attr("name"));
	    }
	    console.log(id);
	    console.log(activities);
	    console.log(bindings);
	    activities[id.substring(id.lastIndexOf('-') + 1)].bindings = bindings;
	    saveScheduleData();
    }
    
    function setBindings(src){
    	
    }

    removeStatus = function(src){
    	var val = $(src).parent().find(".statusText").attr("name");
    	let type = undefined;
		for(var i = 0; i < allFormTypes.length; i++){
			if(allFormTypes[i].code == val){
				type = allFormTypes[i];
				formTypes.push(type);
				break;
			}
		}
    	$(".activity-status-select").append("<option value='"+val+"' class='statusOption'>"+type.name+"</option>");
    	var id = $(src).closest('tr').attr("id");
    	var actIndex = id.substring(id.lastIndexOf('-') + 1);
    	activities[actIndex].bindings.splice(activities[actIndex].bindings.indexOf(val), 1);
    	$(src).parent().remove();
    	saveScheduleData();
    }
    function appendPeriod(i) {
        var item = $('#period-item-template').clone();
        item[0].id = "period-" + i;
        item.removeClass("invisible");
        item.find(".period-date").val(periods[i].date);
        item.find(".period-start").val(periods[i].startTime);
        item.find(".period-end").val(periods[i].endTime);
        $('#time-periods-items').append(item);
    };

    function appendActivity(i) {
        var item = $('#activity-item-template').clone();
        item[0].id = "activity-" + i;
        item.removeClass("invisible");
        item.find(".activity-name").val(activities[i].name);
        item.find(".activity-duration").val(activities[i].duration);
        item.find(".activity-stations").val(activities[i].stations);
        //console.log(activities[i].bindings);
        
        if(activities[i].bindings){
	        for(var x = 0; x < activities[i].bindings.length; x++){
	        	var val = activities[i].bindings[x];
	        	var type;
	        	var y;
	        	for(y= 0; y < formTypes.length; y++){
	        		if(formTypes[y].code == val){
	        			type = formTypes[y];
	        			break;
	        		}
	        	}
	            var stat = $("#status-div-template").clone();
	            stat.removeClass("temp");
	        	stat.find(".statusText").text(type.abbrev);
	            stat.find(".statusText").attr("name",type.code);
	            stat.find(".statusText").attr("title",type.name);
	            item.find(".activity-status").append(stat);
	            formTypes.splice(y,1);
	        }
	    }
        //TODO: populate with options based on status tracking config
        //TODO remove all used ones BEFORE first select.
        /*
        var select = item.find(".activity-status-select");
        for(var x = 0; x < formTypes.length; x++){        	
        	select.append($("<option value='"+formTypes[x]+"' class='statusOption'>"+formTypes[x]+"</option>"))
        }
        */
        $('#activities-items').append(item);
    };
    

    function generateSchedule() {
        $('#loading').show('fast');
        $('#schedule-error-msg').html('');
        $.ajax({
            url: "./?order=" + $("#sort-select").val() + "&times=" + JSON.stringify(periods) + "&activities=" + JSON.stringify(activities),
            type: "POST",
            success: function(data){
                parseTableSchedule(data.teamSchedules);
                parseGridSchedule(data.teamSchedules);
            },
            error: (msg) => {
                $('#schedule-error-msg').html('Error: ' + msg.responseText);
            },
            complete: () => {
                $('#loading').hide('fast');
            }
        });
    };


    function parseTableSchedule(teamSchedules) {
        // Reset table
        $('#inspection-schedule thead tr:first').html('<th></th><th></th>');
        $('#inspection-schedule thead tr:last').html(`<th>${t`Team Number`}</th><th>${t`Team Name`}</th>`);
        $('#inspection-schedule tbody').html('');

        // Add table headers
        var headers = [];
        for (var i = 0; i < teamSchedules[0].schedule.length; i++) {
            headers.push(teamSchedules[0].schedule[i].name);
            $('#inspection-schedule thead tr:first').append('<th colspan="3">' + teamSchedules[0].schedule[i].name + '</th>');
            $('#inspection-schedule thead tr:last').append(`<th>${t`Day`}</th>`);
            $('#inspection-schedule thead tr:last').append(`<th>${t`Time`}</th>`);
            $('#inspection-schedule thead tr:last').append(`<th>${t`Station`}</th>`);
        }

        //  Add table data
        for (var i = 0; i < teamSchedules.length; i ++ ) {
            $('#inspection-schedule tbody').append('<tr></tr>');
            $('#inspection-schedule tbody tr:last').append('<td>' + teamSchedules[i].team.data.displayNumber + '</td>');
            $('#inspection-schedule tbody tr:last').append('<td>' + teamSchedules[i].team.data.name + '</td>');
            for (var j = 0; j < headers.length; j++) {
                var currSchedule = teamSchedules[i].schedule.find(function (e) {
                    return e.name === headers[j];
                });
                const day = new Date(currSchedule.year, currSchedule.month - 1, currSchedule.day).toLocaleString([], {year: 'numeric', month: 'numeric', day: 'numeric'})
                var time = timeFromMinutes(currSchedule.startTime) + ' - ' + timeFromMinutes(currSchedule.startTime + currSchedule.totalTime);
                $('#inspection-schedule tbody tr:last').append('<td>' + day + '</td>');
                $('#inspection-schedule tbody tr:last').append('<td class="text-nowrap">' + time + '</td>');
                $('#inspection-schedule tbody tr:last').append('<td>' + currSchedule.stationName + '</td>');
            }
        }
    }

    function parseGridSchedule(teamSchedules) {
        // Reset keys
        $('#inspection-schedule-grid-key').html('');
        // Reset table
        $('#inspection-schedule-grid thead').html(`<tr><th>${t`Team`}</th></tr>`);
        $('#inspection-schedule-grid tbody').html('');

        // Add time headers from 8am to 8pm
        console.log(teamSchedules);
        for (var i = 8; i <= 12; i++) {
            $('#inspection-schedule-grid thead tr:last').append('<th class="pl-0 pr-0" style="width:7.5%">' + i + ':00</th>');
        }
        for (var i = 13; i < 20; i++) {
            $('#inspection-schedule-grid thead tr:last').append('<th class="pl-0 pr-0" style="width:7.5%">' + (i - 12) + ':00</th>');
        }

        // Assoicate activities with colors and update the key
        var actvColors = [];
        var actvNum = teamSchedules[0].schedule.length;
        for (var i = 0; i < actvNum; i++) {
            actvColors.push({
                activityName: teamSchedules[0].schedule[i].name,
                color: Math.floor(360 / actvNum) * i
            });
            var keyCode = document.createElement('div');
            keyCode.setAttribute('class', 'col font-weight-bold text-center');
            keyCode.setAttribute('style', 'background:hsl(' + actvColors[i].color + ',100%,80%);')
            keyCode.innerHTML = actvColors[i].activityName;
            $('#inspection-schedule-grid-key').append(keyCode);
        }

        //  Add table data row by row
        for (var i = 0; i < teamSchedules.length; i ++ ) {
            // add cell with team number
            $('#inspection-schedule-grid tbody').append('<tr><td>' + teamSchedules[i].team.data.displayNumber + '</td></tr>');
            // add cell that will hold all activity blocks
            $('#inspection-schedule-grid tbody tr:last').append('<td colspan="12" class="position-relative"></td>');

            // create 11 vertical dividers for the cell
            for (var j = 1; j < 12; j++) {
                var timeDivider = document.createElement('div');
                timeDivider.setAttribute('class', 'position-absolute');
                timeDivider.setAttribute('style', 'background:#D3D3D3;left:' + (100 / 12 * j) + '%;top:0;width:1px;height:100%;');
                $('#inspection-schedule-grid tbody td:last').append(timeDivider);
            }

            // create all activity blocks in schedule
            for (var j = 0; j < teamSchedules[i].schedule.length; j++) {
                var currSchedule = teamSchedules[i].schedule[j];

                // find color for this activity
                var currColor = actvColors.find(function (e) {
                    return e.activityName === currSchedule.name;
                });

                // calculate position and width of the activity block
                var blockStart = (currSchedule.startTime - 60 * 8) / (60 * 12) * 100;
                var blockWidth = (currSchedule.startTime + currSchedule.totalTime - 60 * 8) / (60 * 12) * 100 - blockStart;

                // create the activity block and give it necessary attributes
                var timeBlock = document.createElement('div');
                timeBlock.setAttribute('title', currSchedule.name + ': ' +
                    timeFromMinutes(currSchedule.startTime) +
                    ' - ' + timeFromMinutes(currSchedule.startTime + currSchedule.totalTime)
                );
                timeBlock.setAttribute('class', 'position-absolute h-100 font-weight-bold text-center');
                timeBlock.setAttribute('style', 'top:0;' +
                    'left:' + blockStart + '%;' +
                    'width:' + blockWidth + '%;' +
                    'background:hsl(' + currColor.color + ',100%,80%);'
                );
                timeBlock.innerHTML = currSchedule.stationNumber;
                $('#inspection-schedule-grid tbody td:last').append(timeBlock);
            }
        }
    }

    function timeFromMinutes(min) {
        var hours = Math.floor(min / 60);
        var mins = min % 60;
        var sign = hours < 12 ? ' AM' : ' PM';
        if (hours > 12) {
            hours -= 12;
        }
        mins = ("0" + mins).slice(-2);
        return hours + ':' + mins + sign;
    }

    function saveScheduleData() {
        var data = [periods, activities];
        $.ajax({
            url: "./form/",
            type: "POST",
            data: {form:JSON.stringify(data)}
        });
    };

});



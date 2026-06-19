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
$(document).ready(function() {
    var awardIdEditing = null;
    updateAwardsList();
    $("#manage-awards-list-container").sortable({
        update: function(event, ui) {
            var awardItems = $("#manage-awards-list-container .award-item");
            for (i = 0; i < awardItems.length; i++) {
                var awardId = "#" + $(awardItems[i]).attr("id");
                var awardUrl =
                    "?ID=" + awardId.substring(awardId.lastIndexOf('_') + 1) +
                    "&order=" + i;
                $.ajax({
                    url: "../create_award/" + awardUrl,
                    type: "PUT",
                    success: function(){
                        updateAwardsList();
                    }
                });
            }
        }
    });

    $('#manage-awards-list-container').on ('click', '.edit-award-btn', function() {
        if (awardIdEditing !== null) cancelEditAward(awardIdEditing); // cancel last award being edited
        awardIdEditing = "#" + $(this).closest('.award-item').attr("id");
        editAward(awardIdEditing);
    });
    $('#manage-awards-list-container').on ('click', '.cancel-award-btn', function() {
        cancelEditAward(awardIdEditing);
        awardIdEditing = null;
    });
    $('#manage-awards-list-container').on ('click', '.save-award-btn', function() {
        saveAward(awardIdEditing);
    });
    $('#manage-awards-list-container').on ('click', '.delete-award-btn', function() {
        deleteAward("#" + $(this).closest('.award-item').attr("id"));
    });

    $('#manage-awards-add-new-award-btn').click(function() {
        var awardUrl =
            "?name=" + $('#manage-awards-new-award-name').val() +
            "&desc=" + $('#manage-awards-new-award-desc').val() +
            "&teamAward=" + $('#manage-awards-new-award-for-team').is(":checked") +
            "&required=" + $('#manage-awards-new-award-is-required').is(":checked") +
            "&editable=true";
        $.ajax({
            url: "../create_award/" + awardUrl,
            type: "POST",
            success: function(){
                updateAwardsList();
            }
        });
    });

    function updateAwardsList() {
        $.ajax({
            url: "../get_awards/",
            contentType: "application/json",
            success: function(awards){
                $('#manage-awards-list-container').html("");
                awards.sort(function(a, b) {
                    if (a.order < b.order) return -1;
                    if (a.order > b.order) return 1;
                    return 0;
                });
                for (i = 0; i < awards.length; i++) {
                    if (awards[i].awardTypeId === 15 || awards[i].awardTypeId === 16) {
                        // skip dummy awards
                        continue;
                    }
                    var awardItem = $('#manage-awards-award-item').clone(true, true);
                    awardItem[0].id += "_" + awards[i].awardId;
                    awardItem.find('.award-name').html(awards[i].name);
                    awardItem.find('.award-required').attr("id", awardItem.find('.award-required').attr("id") + "_" + awards[i].awardId);
                    awardItem.find('.award-required-label').attr("for", awardItem.find('.award-required-label').attr("for") + "_" + awards[i].awardId);
                  //  awardItem.find('.award-required').prop("checked", awards[i].required);
                    awardItem.find('.award-team').attr("id", awardItem.find('.award-team').attr("id") + "_" + awards[i].awardId);
                    awardItem.find('.award-team-label').attr("for", awardItem.find('.award-team-label').attr("for") + "_" + awards[i].awardId);
                    awardItem.find('.award-team').prop("checked", awards[i].type == 0);
                    awardItem.find('.award-desc').val(awards[i].script);
                    awardItem.find('.award-required').prop("disabled", true); // disable inputs
                    awardItem.find('.award-team').prop("disabled", true); // disable inputs
                    if(awards[i].editable){
                    	awardItem.find(".ops").prop("hidden", false);
                    	if (awards[i].awardTypeId === 1){
                    		awardItem.find(".delete-award-btn").prop("hidden", true);
                    		awardItem.find(".award-team-label").parent().prop("hidden", true);
                    	}
                    }
                    $('#manage-awards-list-container').append(awardItem);
                }
            }
        });
    };

    function editAward(awardId) {
        $(awardId + ' .edit-off').hide();
        $(awardId + ' .edit-on').show();
        $(awardId + " input").prop('disabled', false);
        $(awardId + " textarea").prop('disabled', false);
    }

    function cancelEditAward(awardId) {
        $(awardId + ' .edit-off').show();
        $(awardId + ' .edit-on').hide();
        $(awardId + " input").prop('disabled', true);
        $(awardId + " textarea").prop('disabled', true);
        updateAward(awardId);
    }

    function saveAward(awardId) {
        var awardUrl =
            "?ID=" + awardId.substring(awardId.lastIndexOf('_') + 1) +
            "&desc=" + $(awardId + ' .award-desc').val() +
            "&teamAward=" + $(awardId + ' .award-team').is(":checked") +
            "&required=" + $(awardId + ' .award-required').is(":checked");
        $.ajax({
            url: "../create_award/" + awardUrl,
            type: "PUT",
            success: function(){
                cancelEditAward(awardId);
            }
        });
    }

    function deleteAward(awardId) {
        $.ajax({
            url: "../delete_award/?ID=" + awardId.substring(awardId.lastIndexOf('_') + 1),
            type: "DELETE",
            success: function(){
                updateAwardsList();
            }
        });
    }

    function updateAward(awardId) {
        $.ajax({
            url: "../get_awards/?id=" + awardId.substring(awardId.lastIndexOf('_') + 1),
            success: function(data){
                var award = data;
                $(awardId + ' .award-desc').val(award.script);
                $(awardId + ' .award-team').prop("checked", award.type == 0);
                //$(awardId + ' .award-required').prop("checked", award.required);
            }
        });
    }
});
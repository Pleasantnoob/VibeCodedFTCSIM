/**
 * Sends a QR image to the server for handling
 * @param eventCode : string The event
 * @param team : int The team number we are scanning for
 * @param imageFile : file The image file to send
 * @param setChecks : boolean True if qr is being sent
 * @param onSuccess : Function When the fetch succeeds - the passed summary data may indicate an error state
 * @param onFail : Function When the fetch fails.
 */
async function uploadQrImage(eventCode, team, imageFile, setChecks, onSuccess, onFail) {
    let data = new FormData();
    data.append("image", imageFile);
    fetch(`/event/${eventCode}/qr/?type=image&team=${team}&setChecks=${setChecks ? "true" : "false"}`, {method: 'POST', body: data }).then((res) => {
        if (res.ok) return res.json();
        throw 'Failed to scan';
    }).then((res) => {
        let qrSummary = getQrSummary(team, res);
        onSuccess(qrSummary);
    }).catch(err => {
        onFail(err);
    })
}

function getQrSummary(team, d) {
    let qrSummary = {checked: 0, unchecked: 0, fails: [], raw: d, err: false, errMsg: null, errDetails: null};
    if (d.team !== team) {
        qrSummary.err = true;
        if (d.team === 0) { // The format is incorrect, so we cannot verify the team
            let DS = `Driver Station: <code>${d.qrData.ds.name}</code>`;
            let RC = `Robot Controller: <code>${d.qrData.rc.name}</code>`;
            qrSummary.errMsg = t`QR Error - Invalid device names.`;
            qrSummary.errDetails = `Devices are named incorrectly - cannot verify team number.<br/>${DS}<br/>${RC}`;
        } else { // Wrong team
            qrSummary.errMsg = t`QR Error - Wrong team.`;
            qrSummary.errDetails = t`Incorrect Team! QR data is for team ${d.team}.`;
        }
        return qrSummary;
    }
    for (let itemData of d.result) {
        if (itemData.value && itemData.value > 0) {
            qrSummary.checked++;
        } else {
            qrSummary.unchecked++;
            qrSummary.fails.push(...itemData.details)
        }
    }
    return qrSummary;
}

function showQrSummary(qrSummary, team) {
    if (qrSummary.err) {
        showQrError(qrSummary);
        return;
    }
    let content = `<div class="alert alert-success text-center">${qrSummary.checked} checks passed!</div>`;
    if (qrSummary.fails && qrSummary.fails.length > 0) {
        content += `The following checks did not pass automated inspection:<ol>`;
        for (let x of qrSummary.fails) {
            content += `<li>${x}</li>`
        }
        content += "</ol>"
    }
    messageDialog({label: t`Automated Inspection Summary - ${team}`, text: content, dangerous: true});
}

function showQrError(qrSummary) {
    messageDialog({label: t`Automated Inspection Error`, text: qrSummary.errDetails, dangerous: true})
}

function qrHelp(showNote = true) {
    let content = `
			1. Ensure the robot is on, connected to the DS, and the gamepads are connected to the DS.<br/>
			2. On the Driver Station, go to Self Inspect -> Robot Controller -> scroll to the bottom.<br/>
			3. On this device, tap the "Scan QR" button to take a picture of the QR.<br/>
			4. If there are inspection issues, a link will appear to a summary of the scan results.<br/>
			If scan fails, try:<ul>
				<li>Make sure the QR is fully visible and in-focus. You may need to hold this device further away from the DS.</li>
				<li>Orient the DS in portrait mode</li>
				<li>Turn up the DS brightness</li>
			</ul>
			${showNote ? `<div class="alert alert-info">Note: Not all checks can be automated. After a scan, use the "Highlight Missing" button to see what needs to be checked manually.</div>` : ""}
		`;
    messageDialog({label: 'Automated Inspection Help', text: content, large: true, dangerous: true});
}
/**
 * Sends a QR image to the server for handling
 * @param imageFile : file The image file to send
 * @param onSuccess : Function When the fetch succeeds - the passed summary data may indicate an error state
 * @param onFail : Function When the fetch fails.
 */
async function uploadLoginQrImage(imageFile, onSuccess, onFail) {
    let data = new FormData();
    data.append("image", imageFile);
    fetch(`/login/qr/?type=image`, {method: 'POST', body: data }).then((res) => {
        if (res.ok) return res.text();
        throw 'Failed to scan';
    }).then((new_url) => {
        window.location.href = new_url;
    }).catch(err => {
        onFail(err);
    })
}

function loginQrHelp() {
    let content = `
			This option can be used to scan a default account QR code to log in and is intended for devices without a built-in QR reader.
			The QR code can be scanned using any QR reader.
			If this device has a built-in QR reader, try using that instead as it is likely optimized for this device. 
			`;
    messageDialog({label: 'QR Login Help', text: content, large: true});
}

function loginQrImage() {
    const input = document.getElementById('qrInput');
    if (input.files.length === 0) { // No file selected, ignore
        return;
    }
    const imageFile = input.files[0];
    let resultDiv = $("#qrResult");
    resultDiv.text('Scanning...').removeClass("alert alert-danger");
    uploadLoginQrImage(imageFile, () => {
        window.location.href = "/";  // login succeeded, redir to home
    }, (err) => {
        console.error(err);
        resultDiv.text("Failed to scan QR").addClass("alert alert-danger");
    });
}
function fileUploadDialog({label, text, accept = null, filter = null, onSubmit, maxSize=0, onFileSelect = null}) {
    if (accept === null && filter) {
        accept = filter.regex;
    }
    $('#uploadModalLabel').text(label);
    $('#uploadModalInputLabel').html(text);
    $('#uploadModalFile').attr("accept", accept).off('change');
    if (onFileSelect) {
        $('#uploadModalFile').on('change', () => onFileSelect($("#uploadModalFile").prop('files')));
    }
    $('#uploadModalSubmit').off('click').on("click", () => {
        $("#uploadModalSubmit").text(t`Uploading...`).prop("disabled", true);
        uploadModalSubmit(filter, onSubmit, maxSize)
            .then(() => $('#uploadModal').modal('hide'))
            .catch(error => $('#uploadModalError').text(error.message))
            .finally(() => $("#uploadModalSubmit").text(t`Upload`).prop("disabled", false));
    });
    $('#uploadModal').modal('show');
}

async function uploadModalSubmit(filter, postUpload, maxSize) {
    const files = $("#uploadModalFile").prop('files');
    if (maxSize > 0 && files[0]?.size > maxSize) {
        const size = maxSize / 1024;
        throw new Error(t`File must be smaller than ${size}kB`);
    }
    let uploadId = await uploadFile(files[0], filter);
    if (uploadId.error) {
        throw new Error(uploadId.error);
    } else {
        $('#uploadModalError').text('');
        if (postUpload) {
            // await so if error thrown we can propagate it to display the text in the modal.
            await postUpload({id: uploadId, name: files[0].name, type: files[0].type});
        }
    }
}
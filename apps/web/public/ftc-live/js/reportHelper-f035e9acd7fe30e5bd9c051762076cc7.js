function statefulCheckbox(id, onChange, defaultValue = false) {
    const key = `${window.location}_${id}-checked`;
    function onPageReady() {
        const storedValue = sessionStorage.getItem(key)
        const initialValue = storedValue === null ? defaultValue : (storedValue === '1')
        onChange(initialValue)
        document.getElementById(id).checked = initialValue
    }
    document.addEventListener("DOMContentLoaded", onPageReady)
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onPageReady()
    }
    document.getElementById(id).addEventListener("change", function(evt) {
        const newValue = evt.target.checked

        onChange(newValue)
        if(newValue !== defaultValue) {
            sessionStorage.setItem(key, newValue ? '1' : '0')
        } else {
            sessionStorage.removeItem(key)
        }
    })
}

function statefulSelect(id, onChange, defaultValue) {
    const key = `${window.location}_${id}-value`;
    function onPageReady() {
        const storedValue = sessionStorage.getItem(key)
        const initialValue = storedValue === null ? defaultValue : storedValue
        onChange(initialValue)
        document.getElementById(id).value = initialValue
    }
    document.addEventListener("DOMContentLoaded", onPageReady)
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onPageReady()
    }
    document.getElementById(id).addEventListener("change", function(evt) {
        const newValue = evt.target.value

        onChange(newValue)
        if(newValue !== defaultValue) {
            sessionStorage.setItem(key, newValue)
        } else {
            sessionStorage.removeItem(key)
        }
    })
}
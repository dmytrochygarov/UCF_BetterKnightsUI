$(document).ready(function() {
    // Get the toggle switch element
    const $toggleSwitch = $('#toggleExtension');

    // Load the toggle state from storage and update the UI. Must be the
    // promise form: webextension-polyfill's storage.sync.get takes at most
    // one argument and throws synchronously on the callback form, which
    // would abort this ready handler before the change listener below binds.
    browser.storage.sync.get('extensionEnabled').then(function(data) {
        let _extensionEnabled = data.extensionEnabled !== undefined ? data.extensionEnabled : true;
        $toggleSwitch.prop('checked', _extensionEnabled); // Set the initial state of the checkbox
        $('#toggleExtensionLabel').text(_extensionEnabled ? "Extension Enabled" : "Extension Disabled");
    });

    // Event listener for when the toggle is clicked
    $toggleSwitch.on('change', function() {
        const isEnabled = $toggleSwitch.is(':checked'); // Check if it's enabled

        // Save the new state to Chrome storage
        browser.storage.sync.set({
            extensionEnabled: isEnabled
        });

        // change text of "#toggleExtensionLabel" to either "Extension enabled" or "Extension disabled"
        $('#toggleExtensionLabel').text(isEnabled ? "Extension Enabled" : "Extension Disabled");

        // No message to the background script: the content scripts read
        // extensionEnabled from storage on every scan tick, and the
        // background listener has no branch for such a message anyway.
    });
});
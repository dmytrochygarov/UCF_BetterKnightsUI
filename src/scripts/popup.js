$(document).ready(function() {
    // Get the toggle switch element
    const $toggleSwitch = $('#toggleExtension');
    const $exportBtn = $('#popupCalendarExport');
    const $exportHint = $('#popupCalendarExportHint');

    function readExtensionEnabled() {
        return browser.storage.sync.get('extensionEnabled').then(function(data) {
            return data.extensionEnabled !== undefined ? data.extensionEnabled : true;
        });
    }

    function applyCalendarExportPopupState(probe) {
        const state = calendarExportPopupState(probe);
        $exportBtn.text(state.buttonLabel);
        $exportBtn.prop('disabled', !state.available);
        $exportBtn.attr('aria-disabled', state.available ? 'false' : 'true');
        $exportHint.text(state.available ? '' : state.inactiveHint);
        $exportHint.toggle(!state.available);
    }

    // Message the active tab directly; only the frame hosting My Class
    // Schedule list view answers (see calendar_export_page.js). Rejects when
    // the tab has no content scripts at all — treated as "not on schedule".
    function activeTabMessage(action) {
        return browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
            const tab = tabs && tabs[0];
            if (!tab || tab.id == null) return undefined;
            return browser.tabs.sendMessage(tab.id, { action: action });
        });
    }

    function probeCalendarExport() {
        readExtensionEnabled().then(function(enabled) {
            if (!enabled) {
                applyCalendarExportPopupState({
                    onSchedule: false,
                    extensionEnabled: false
                });
                return;
            }
            return activeTabMessage('bkuiCalendarExportProbe').then(function(response) {
                applyCalendarExportPopupState({
                    onSchedule: !!(response && response.onSchedule),
                    extensionEnabled: true
                });
            });
        }).catch(function() {
            applyCalendarExportPopupState({ onSchedule: false });
        });
    }

    $exportBtn.on('click', function() {
        if ($exportBtn.prop('disabled')) return;

        readExtensionEnabled().then(function(enabled) {
            if (!enabled) {
                applyCalendarExportPopupState({
                    onSchedule: false,
                    extensionEnabled: false
                });
                return;
            }
            return activeTabMessage('bkuiCalendarExportRun').then(function(response) {
                const result = response && response.ok ? response.result : null;
                if (!result) {
                    probeCalendarExport();
                    return;
                }
                // Download from the popup: the schedule frame is a
                // cross-origin iframe where Chrome blocks downloads without
                // a user gesture, and the gesture happened here.
                if (result.exported > 0) {
                    downloadCalendarIcs(result.ics, calendarExportFilename());
                }
                $exportHint.text(formatCalendarExportToast(result)).show();
            });
        }).catch(function() {
            probeCalendarExport();
        });
    });

    // Load the toggle state from Chrome storage and update the UI
    browser.storage.sync.get('extensionEnabled', function(data) {
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

        // Change label
        $('#toggleExtensionLabel').text(isEnabled ? "Extension Enabled" : "Extension Disabled");

        // Send a message to the background script
        browser.runtime.sendMessage({
            action: 'toggleExtension',
            enabled: isEnabled
        }, function(response) {
            console.log("Background script response:", response);
        });

        // Keep the Export control in sync with the new enabled state.
        probeCalendarExport();
    });

    probeCalendarExport();
});

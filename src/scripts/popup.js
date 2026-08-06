$(document).ready(function() {
    // Get the toggle switch element
    const $toggleSwitch = $('#toggleExtension');
    const $exportBtn = $('#popupCalendarExport');
    const $exportHint = $('#popupCalendarExportHint');
    let probeGeneration = 0;

    function readExtensionEnabled() {
        return browser.storage.sync.get('extensionEnabled').then(function(data) {
            return data.extensionEnabled !== undefined ? data.extensionEnabled : true;
        });
    }

    function applyCalendarExportPopupState(probe) {
        const state = typeof calendarExportPopupState === 'function'
            ? calendarExportPopupState(probe)
            : {
                available: !!(probe && probe.onSchedule) &&
                    (!probe || probe.extensionEnabled !== false),
                buttonLabel: 'Export to calendar',
                inactiveHint: (!probe || probe.extensionEnabled !== false)
                    ? 'Open My Class Schedule (list view) to export.'
                    : 'Enable the extension to export your schedule.'
            };

        $exportBtn.text(state.buttonLabel);
        $exportBtn.prop('disabled', !state.available);
        $exportBtn.attr('aria-disabled', state.available ? 'false' : 'true');
        $exportHint.text(state.available ? '' : state.inactiveHint);
        $exportHint.toggle(!state.available);
    }

    function probeCalendarExport(attempt) {
        const tries = attempt || 0;
        const generation = probeGeneration;

        readExtensionEnabled().then(function(enabled) {
            if (generation !== probeGeneration) return;

            if (!enabled) {
                applyCalendarExportPopupState({
                    onSchedule: false,
                    extensionEnabled: false
                });
                return;
            }

            browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
                if (generation !== probeGeneration) return;

                const tab = tabs && tabs[0];
                if (!tab || tab.id == null) {
                    applyCalendarExportPopupState({
                        onSchedule: false,
                        extensionEnabled: true
                    });
                    return;
                }

                browser.runtime.sendMessage({
                    action: 'bkuiCalendarExportProbe',
                    tabId: tab.id
                }).then(function(response) {
                    if (generation !== probeGeneration) return;

                    return readExtensionEnabled().then(function(stillEnabled) {
                        if (generation !== probeGeneration) return;

                        if (!stillEnabled) {
                            applyCalendarExportPopupState({
                                onSchedule: false,
                                extensionEnabled: false
                            });
                            return;
                        }

                        const onSchedule = !!(response && response.onSchedule);
                        if (!onSchedule && tries < 12) {
                            // Scan loop / PeopleSoft DOM may need a moment before the port opens.
                            setTimeout(function() {
                                if (generation !== probeGeneration) return;
                                probeCalendarExport(tries + 1);
                            }, 250);
                            return;
                        }
                        applyCalendarExportPopupState({
                            onSchedule: onSchedule,
                            extensionEnabled: true
                        });
                    });
                }).catch(function() {
                    if (generation !== probeGeneration) return;

                    if (tries < 12) {
                        setTimeout(function() {
                            if (generation !== probeGeneration) return;
                            probeCalendarExport(tries + 1);
                        }, 250);
                        return;
                    }
                    applyCalendarExportPopupState({
                        onSchedule: false,
                        extensionEnabled: true
                    });
                });
            }).catch(function() {
                if (generation !== probeGeneration) return;
                applyCalendarExportPopupState({
                    onSchedule: false,
                    extensionEnabled: true
                });
            });
        }).catch(function() {
            if (generation !== probeGeneration) return;
            applyCalendarExportPopupState({ onSchedule: false });
        });
    }

    applyCalendarExportPopupState({ onSchedule: false });

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

            return browser.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
                const tab = tabs && tabs[0];
                if (!tab || tab.id == null) return;

                return browser.runtime.sendMessage({
                    action: 'bkuiCalendarExportRun',
                    tabId: tab.id
                }).then(function(response) {
                    if (response && response.ok) {
                        window.close();
                        return;
                    }
                    return readExtensionEnabled().then(function(stillEnabled) {
                        if (!stillEnabled) {
                            applyCalendarExportPopupState({
                                onSchedule: false,
                                extensionEnabled: false
                            });
                            return;
                        }
                        if (response && response.onSchedule) {
                            applyCalendarExportPopupState({
                                onSchedule: true,
                                extensionEnabled: true
                            });
                            return;
                        }
                        probeCalendarExport();
                    });
                });
            });
        }).catch(function() {
            /* leave popup open if the run failed to reach the page */
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
        probeGeneration += 1;

        // Save the new state to Chrome storage
        browser.storage.sync.set({
            extensionEnabled: isEnabled
        });

        // change text of "#toggleExtensionLabel" to either "Extension enabled" or "Extension disabled"
        $('#toggleExtensionLabel').text(isEnabled ? "Extension Enabled" : "Extension Disabled");

        // Send message to background script to enable/disable the extension
        browser.runtime.sendMessage({
            extensionEnabled: isEnabled
        }, function(response) {
            console.log("Background script response:", response);
        });

        // Port drops when disabled; re-probe so the Export control matches.
        if (!isEnabled) {
            applyCalendarExportPopupState({
                onSchedule: false,
                extensionEnabled: false
            });
        } else {
            probeCalendarExport();
        }
    });

    probeCalendarExport();
});

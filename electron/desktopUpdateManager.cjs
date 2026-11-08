'use strict';

/**
 * Premier Windows signed-release updater. Never touches the current IndexedDB
 * queue or attempts installing while an unacknowledged transaction may exist.
 * Automatic install is only attempted on a REAL app quit (not window hide).
 */
const { EventEmitter } = require('node:events');

const RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 15 * 1000;
const EXIT_CHECK_TIMEOUT_MS = 7 * 1000;

function policyIsApproved(policy) {
  return policy?.enabled === true
    && policy.channel === 'stable'
    && policy.provider?.type === 'github'
    && policy.provider?.owner === 'Premieros'
    && policy.provider?.repo === '.com'
    && typeof policy.publisherName === 'string'
    && policy.publisherName.trim().length >= 3
    && policy.minimumBacklogCheck === true;
}

function createDesktopUpdateManager({
  app, updater, policy, inspectSafeExit,
  logger = console, platform = process.platform,
  scheduleTimeout = setTimeout, scheduleInterval = setInterval,
  clearScheduledTimeout = clearTimeout, clearScheduledInterval = clearInterval,
}) {
  if (!app || typeof app.quit !== 'function' || typeof inspectSafeExit !== 'function') {
    throw new Error('PREMIER_UPDATE_INVALID_DEPENDENCIES');
  }
  const approved = policyIsApproved(policy) && platform === 'win32' && app.isPackaged === true;
  let state = approved ? 'idle' : 'disabled';
  let downloadedVersion = null;
  let latestVersion = null;
  let bypass = false;
  let installing = false;
  let checkBusy = false;
  let started = false;
  let startupTimer = null;
  let intervalTimer = null;

  function status() {
    return Object.freeze({
      state,
      enabled: approved,
      downloaded: state === 'downloaded',
      downloadedVersion,
      latestVersion,
      autoInstallOnExit: approved,
      // Only signed NSIS updates are handled. Portable EXEs aren't self-updating.
      installerType: 'nsis',
    });
  }

  async function check() {
    if (!approved || !started || checkBusy || state === 'downloaded' || installing) return;
    checkBusy = true;
    state = 'checking';
    try {
      await updater.checkForUpdates();
      // Events 'update-available' / 'update-downloaded' own the state.
      if (state === 'checking') state = 'idle';
    } catch (error) {
      state = 'error';
      logger.warn('[Premier Desktop] Signed update check failed:', error?.message || 'unknown');
    } finally {
      checkBusy = false;
    }
  }

  function start() {
    if (started) return status();
    started = true;
    if (!approved) return status();
    if (!updater || typeof updater.checkForUpdates !== 'function' ||
        typeof updater.quitAndInstall !== 'function') {
      state = 'disabled';
      throw new Error('PREMIER_UPDATE_CLIENT_UNAVAILABLE');
    }
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.on('update-available', info => {
      latestVersion = info?.version || null;
      if (state !== 'downloaded') state = 'downloading';
    });
    updater.on('update-not-available', () => {
      if (state !== 'downloaded') state = 'idle';
    });
    updater.on('download-progress', () => {
      if (state !== 'downloaded') state = 'downloading';
    });
    updater.on('update-downloaded', info => {
      downloadedVersion = info?.version || null;
      state = 'downloaded';
    });
    updater.on('error', error => {
      if (state !== 'downloaded') state = 'error';
      logger.warn('[Premier Desktop] Update failed:', error?.message || 'unknown');
    });
    startupTimer = scheduleTimeout(() => void check(), STARTUP_DELAY_MS);
    intervalTimer = scheduleInterval(() => void check(), RETRY_INTERVAL_MS);
    return status();
  }

  function beforeQuit(event) {
    // Do not block an ordinary exit unless a verified signed update is ready.
    if (!approved || state !== 'downloaded' || bypass || installing) return;
    event.preventDefault();
    const timeoutResult = new Promise(resolve => {
      const timer = setTimeout(() => resolve({ safe: false, reason: 'EXIT_SAFETY_TIMEOUT' }),
        EXIT_CHECK_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    });
    Promise.race([Promise.resolve().then(inspectSafeExit), timeoutResult])
      .then(result => {
        if (result?.safe !== true) {
          logger.warn('[Premier Desktop] Update deferred; unsafe to install:', result?.reason || 'unknown');
          bypass = true;
          app.quit();
          return;
        }
        installing = true;
        // The signed installer is applied only AFTER this real app quit.
        // Never call quitAndInstall while the user continues cashier work.
        updater.quitAndInstall(false, true);
      })
      .catch(error => {
        logger.warn('[Premier Desktop] Update deferred; exit guard failed:',
          error?.message || 'unknown');
        bypass = true;
        app.quit();
      });
  }

  function stop() {
    if (startupTimer != null) clearScheduledTimeout(startupTimer);
    if (intervalTimer != null) clearScheduledInterval(intervalTimer);
  }
  return Object.freeze({ start, check, beforeQuit, status, stop });
}

module.exports = { createDesktopUpdateManager, policyIsApproved };

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.APP_URL ?? 'http://localhost:7451';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const errors = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 390, height: 667 }, { width: 844, height: 390 }]) {
    const mobile = viewport.width < 900;
    const context = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile });
    await context.addInitScript(() => {
      window.testAudioContexts = [];
      window.testAudioSources = [];
      window.testAudioOscillators = [];
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(...args) {
          super(...args);
          window.testAudioContexts.push(this);
        }
        createBufferSource() {
          const source = super.createBufferSource();
          window.testAudioSources.push(source);
          return source;
        }
        createOscillator() {
          const oscillator = super.createOscillator();
          window.testAudioOscillators.push(oscillator);
          return oscillator;
        }
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // webxdc-dev emits this experimental host directive, which Chromium ignores.
      if (message.text() === "Unrecognized Content-Security-Policy directive 'webrtc'.") return;
      errors.push(message.text());
    });
    const external = [];
    page.on('request', request => {
      if (!request.url().startsWith('http://localhost:') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) external.push(request.url());
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Own the sky.' }).waitFor();
    assert.equal(await page.evaluate(() => window.testAudioContexts.length), 0, 'No audio before the launch gesture');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `briefing-${viewport.width}.png`) });
    await page.getByRole('button', { name: /Flight school/ }).click();
    const initialThumbnail = await page.locator('app-aircraft-preview canvas').screenshot();
    const aircraftNames = ['F-14 Tomcat', 'F-15E Strike Eagle', 'F-22 Raptor', 'Northrop YF-23 Black Widow II'];
    const selectedAircraft = aircraftNames[viewport.width === 1440 ? 0 : viewport.width === 844 ? 3 : viewport.height === 667 ? 2 : 1];
    await page.getByRole('button', { name: selectedAircraft, exact: true }).click();
    await page.waitForFunction(name => [...document.querySelectorAll('.aircraft-options button')]
      .some(button => button.textContent.trim() === name && button.getAttribute('aria-pressed') === 'true'), selectedAircraft);
    await page.getByRole('img', { name: `${selectedAircraft} aircraft preview`, exact: true }).waitFor();
    const selectedThumbnail = await page.locator('app-aircraft-preview canvas').screenshot();
    assert.equal(initialThumbnail.equals(selectedThumbnail), false, 'Aircraft selection must change the rendered thumbnail');
    await page.getByRole('button', { name: 'F/A-27 Multirole', exact: true }).click();
    await page.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('.notification')?.textContent.includes('STEP 1/7'));
    assert.match(await page.locator('.notification').innerText(), mobile ? /stick down/ : /Down \/ S/);
    await page.waitForFunction(() => window.testAudioSources.some(source => source.buffer?.duration > 40 && source.loop));
    const signal = await page.evaluate(() => {
      const buffer = window.testAudioSources.find(source => source.buffer?.duration > 40).buffer;
      let square = 0, peak = 0;
      const data = buffer.getChannelData(0);
      for (const sample of data) { square += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      return {
        duration: buffer.duration, rms: Math.sqrt(square / data.length), peak,
        seam: Math.abs(data[0] - data[data.length - 1]),
        state: window.testAudioContexts[0].state,
      };
    });
    assert.ok(signal.duration > 40 && signal.duration < 43);
    assert.ok(signal.rms > 0.005 && signal.peak < 1, `Non-silent, unclipped score: ${JSON.stringify(signal)}`);
    assert.ok(signal.seam < 0.02, 'Loop boundary must not introduce a click');
    assert.equal(signal.state, 'running');
    await page.getByRole('button', { name: 'Music settings', exact: true }).click();
    await page.getByRole('slider', { name: 'Music volume' }).fill('20');
    await page.getByRole('button', { name: 'MUTE MUSIC', exact: true }).click();
    await page.waitForFunction(() => window.testAudioContexts[0].state === 'suspended');
    assert.equal(await page.evaluate(() => window.testAudioContexts[1].state), 'running', 'Music mute must preserve engine and alarms');
    await page.getByRole('slider', { name: 'Sound effects volume' }).fill('40');
    await page.getByRole('button', { name: 'MUTE EFFECTS', exact: true }).click();
    await page.waitForFunction(() => window.testAudioContexts[1].state === 'suspended');
    await page.getByRole('button', { name: 'ENABLE EFFECTS', exact: true }).click();
    await page.waitForFunction(() => window.testAudioContexts[1].state === 'running');
    assert.equal(await page.getByRole('slider', { name: 'Sound effects volume' }).inputValue(), '40');
    await page.getByRole('button', { name: 'ENABLE MUSIC', exact: true }).click();
    await page.waitForFunction(() => window.testAudioContexts[0].state === 'running');
    assert.equal(await page.getByRole('slider', { name: 'Music volume' }).inputValue(), '20');
    await page.getByRole('button', { name: 'Close music settings' }).click();
    await page.getByRole('button', { name: 'Autopilot settings', exact: true }).click();
    await page.getByRole('button', { name: 'CAPTURE & HOLD', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('HDG / ALT / SPD'));
    await page.getByRole('spinbutton', { name: 'Autopilot heading' }).fill('15');
    await page.getByRole('spinbutton', { name: 'Autopilot altitude' }).fill('4000');
    await page.getByRole('spinbutton', { name: 'Autopilot airspeed' }).fill('350');
    await page.getByRole('spinbutton', { name: 'Autopilot airspeed' }).blur();
    assert.equal(await page.getByRole('spinbutton', { name: 'Autopilot heading' }).inputValue(), '15');
    await page.getByRole('button', { name: 'Close autopilot settings' }).click();
    await page.getByRole('slider', { name: 'Engine throttle' }).fill('75');
    await page.getByRole('slider', { name: 'Engine throttle' }).blur();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('OFF'));
    await page.getByRole('button', { name: 'Autopilot settings', exact: true }).click();
    await page.getByRole('button', { name: 'WINGS LEVEL', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('LEVEL / SPD'));
    assert.equal(await page.getByRole('spinbutton', { name: 'Autopilot heading' }).isDisabled(), true);
    await page.getByRole('button', { name: 'DISCONNECT · H', exact: true }).click();
    await page.getByRole('button', { name: 'RETURN & LAND', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('RWY 36 / RETURN'));
    assert.equal(await page.getByRole('spinbutton', { name: 'Autopilot airspeed' }).isDisabled(), true);
    await page.getByRole('button', { name: 'GO AROUND', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('GO-AROUND'));
    await page.getByRole('button', { name: 'DISCONNECT · H', exact: true }).click();
    await page.getByRole('button', { name: 'STALL RECOVERY · T', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('STALL RECOVERY'));
    assert.equal(await page.getByRole('spinbutton', { name: 'Autopilot airspeed' }).isDisabled(), true);
    await page.getByRole('button', { name: 'DISCONNECT · H', exact: true }).click();
    await page.getByRole('button', { name: 'Close autopilot settings' }).click();
    await page.getByRole('button', { name: 'Open mission briefing' }).click();
    await page.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await page.locator('.modal-backdrop').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.mission-strip').textContent().then(t => t.includes('Flight school')), true);
    const flaps = page.locator('.configuration button').nth(1);
    await flaps.click();
    await page.waitForFunction(() => document.querySelectorAll('.configuration button')[1]?.classList.contains('active'));
    await flaps.click();
    await page.getByRole('button', { name: 'Controls and flight manual' }).click();
    await page.getByRole('heading', { name: 'Know your aircraft.' }).waitFor();
    await page.waitForFunction(() => window.testAudioContexts[0].state === 'suspended');
    await page.waitForFunction(() => window.testAudioContexts[1].state === 'suspended');
    await page.getByRole('button', { name: 'UNDERSTOOD' }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('heading', { name: 'Take a breath.' }).waitFor();
    await page.getByRole('button', { name: /RESUME FLIGHT/ }).click();
    await page.waitForFunction(() => window.testAudioContexts[0].state === 'running');
    await page.waitForFunction(() => window.testAudioContexts[1].state === 'running');
    await page.keyboard.press('h');
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('HDG / ALT / SPD'));
    const timeBeforeBlur = await page.locator('.timer').innerText();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(before => document.querySelector('.timer')?.innerText !== before, timeBeforeBlur);
    assert.equal(await page.getByRole('heading', { name: 'Take a breath.' }).count(), 0, 'Focus loss must not pause flight');
    assert.match(await page.locator('.autopilot-status').innerText(), /HDG \/ ALT \/ SPD/, 'Focus loss must preserve autopilot');
    assert.equal(await page.evaluate(() => window.testAudioContexts.every(context => context.state === 'running')), true);
    await page.keyboard.press('h');
    const throttle = page.getByRole('slider', { name: 'Engine throttle' });
    await throttle.fill('90');
    assert.equal(await throttle.inputValue(), '90');
    await throttle.evaluate(element => element.blur());
    await page.waitForFunction(() => window.testAudioOscillators.length === 2 && window.testAudioOscillators.every(node => node.frequency.value > 340));
    await throttle.fill('0');
    await throttle.evaluate(element => element.blur());
    await page.waitForFunction(() => window.testAudioOscillators.every(node => node.frequency.value < 110));
    await throttle.fill('90');
    await throttle.evaluate(element => element.blur());
    if (mobile) {
      await page.getByRole('button', { name: 'Autopilot settings', exact: true }).click();
      await page.getByRole('button', { name: 'CAPTURE & HOLD', exact: true }).click();
      await page.getByRole('button', { name: 'Close autopilot settings' }).click();
      const stick = page.locator('.flight-stick');
      assert.equal(await stick.isVisible(), true);
      const box = await stick.boundingBox();
      assert.ok(box);
      const gun = page.locator('.weapons .weapon').nth(1);
      const gunBox = await gun.boundingBox();
      assert.ok(gunBox);
      const session = await context.newCDPSession(page);
      const gunTouch = { id: 2, x: gunBox.x + gunBox.width / 2, y: gunBox.y + gunBox.height / 2 };
      const stickTouch = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stickTouch, gunTouch] });
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...stickTouch, y: box.y + box.height * 0.75 }, gunTouch] });
      await page.waitForTimeout(300);
      assert.ok(await page.locator('.stick-knob').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 > 10), 'Touch stick must actually deflect');
      assert.match(await page.locator('.autopilot-status').innerText(), /OFF/, 'Touch stick must disconnect autopilot');
      assert.ok(Number(await gun.locator('strong').innerText()) < 640, 'Cannon must fire while the stick is held');
      assert.ok(await page.evaluate(() => window.testAudioSources.some(source => !source.loop
        && Math.abs((source.buffer?.duration ?? 0) - 0.09) < 0.001)), 'Fired cannon rounds must produce gun audio');
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...stickTouch, y: box.y + box.height * 0.75 }] });
      await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.stick-knob')).transform).m42 === 0);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(100);
      const rounds = await gun.locator('strong').innerText();
      await page.waitForTimeout(150);
      assert.equal(await gun.locator('strong').innerText(), rounds, 'Releasing the gun must stop firing');
      const reports = () => page.evaluate(() => window.testAudioSources.filter(source => !source.loop
        && Math.abs((source.buffer?.duration ?? 0) - 0.09) < 0.001).length);
      const reportCount = await reports();
      await page.waitForTimeout(150);
      assert.equal(await reports(), reportCount, 'Releasing the gun must stop producing reports');
      await session.detach();
    } else {
      await page.keyboard.press('h');
      await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('HDG / ALT / SPD'));
      await page.keyboard.down('ArrowDown');
      await page.waitForTimeout(250);
      await page.keyboard.up('ArrowDown');
      assert.match(await page.locator('.autopilot-status').innerText(), /OFF/, 'Keyboard control must disconnect autopilot');
      await page.keyboard.press('v');
      await page.waitForFunction(() => document.querySelector('main')?.classList.contains('cockpit'));
      assert.equal(await page.locator('main').evaluate(el => el.classList.contains('cockpit')), true);
    }
    await page.getByRole('button', { name: 'Open mission briefing' }).click();
    await page.getByRole('button', { name: /Coastal intercept/ }).click();
    await page.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.radar-contact').length === 3);
    assert.equal(await page.locator('.radar-contact').count(), 3);
    assert.equal(await page.locator('.radar-base').count(), 1, 'Radar must show home base');
    assert.match(await page.locator('.radar-home').innerText(), /HOME\s+\d{3}° · \d+\.\d KM/);
    await page.locator('.radar-scope').click();
    assert.match(await page.locator('.radar-range').innerText(), /^12 KM/, 'Tapping the radar must zoom out');
    if (!mobile) {
      await page.keyboard.press('Shift+KeyZ');
      assert.match(await page.locator('.radar-range').innerText(), /^6 KM/, 'Shift+Z must step radar range back');
    } else {
      await page.locator('.radar-range').click();
      await page.locator('.radar-range').click();
      await page.locator('.radar-range').click();
      assert.match(await page.locator('.radar-range').innerText(), /^6 KM/, 'Radar range must cycle back to 6 km');
    }
    await page.getByRole('button', { name: mobile ? 'Cycle touch target' : 'Cycle target', exact: true }).click();
    await page.getByRole('button', { name: /FLARES/ }).click();
    await page.waitForTimeout(200);
    assert.match(await page.locator('.flare-button strong').innerText(), /22/);
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, `flight-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'MISSION SELECT' }).click();
    await page.getByRole('checkbox', { name: /Start on runway/ }).check();
    await page.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.phase-tag').textContent(), 'parked');
    await page.getByRole('button', { name: 'Autopilot settings', exact: true }).click();
    await page.getByRole('button', { name: 'CAPTURE & HOLD', exact: true }).click();
    assert.match(await page.locator('.autopilot-status').innerText(), /OFF/, 'No automatic takeoff');
    await page.getByRole('button', { name: 'AUTO TAKEOFF', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('AUTO TAKEOFF'));
    assert.equal(await page.getByRole('button', { name: 'RETURN & LAND', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'DISCONNECT · H', exact: true }).click();
    await page.getByRole('button', { name: 'Close autopilot settings' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    assert.deepEqual(external, [], 'App should make no external network requests');
    await page.reload();
    await page.getByRole('heading', { name: 'Own the sky.' }).waitFor();
    assert.equal(await page.evaluate(() => window.testAudioContexts.length), 0, 'Restoring volumes must not start audio');
    await page.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await page.getByRole('button', { name: 'Music settings', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: 'Music volume' }).inputValue(), '20');
    assert.equal(await page.getByRole('slider', { name: 'Sound effects volume' }).inputValue(), '40');
    console.log(`Browser smoke passed: ${viewport.width} x ${viewport.height}`);
    await context.close();
  }
  for (const invalid of ['{"musicVolume":2,"effectsVolume":0.4}', 'not-json']) {
    const storageContext = await browser.newContext();
    await storageContext.addInitScript(value => localStorage.setItem('machstrike-audio', value), invalid);
    const storagePage = await storageContext.newPage();
    storagePage.on('pageerror', error => errors.push(error.message));
    await storagePage.goto(url);
    await storagePage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await storagePage.getByRole('button', { name: 'Music settings', exact: true }).click();
    await storagePage.getByText('Saved volume settings could not be restored. Default volumes are in use.').waitFor();
    assert.equal(await storagePage.getByRole('slider', { name: 'Music volume' }).inputValue(), '35');
    assert.equal(await storagePage.getByRole('slider', { name: 'Sound effects volume' }).inputValue(), '55');
    await storagePage.getByRole('slider', { name: 'Music volume' }).fill('0');
    assert.equal(await storagePage.getByText('Saved volume settings could not be restored. Default volumes are in use.').count(), 0);
    await storageContext.close();
  }
  const legacyStorage = await browser.newContext();
  await legacyStorage.addInitScript(() => {
    localStorage.setItem('afterburner-audio', '{"musicVolume":0.2,"effectsVolume":0.4}');
    localStorage.setItem('afterburner-best', '12345');
  });
  const legacyPage = await legacyStorage.newPage();
  legacyPage.on('pageerror', error => errors.push(error.message));
  await legacyPage.goto(url);
  await legacyPage.getByRole('heading', { name: 'Own the sky.' }).waitFor();
  assert.match(await legacyPage.locator('.best-score').innerText(), /12,345/);
  await legacyPage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
  await legacyPage.getByRole('button', { name: 'Music settings', exact: true }).click();
  assert.equal(await legacyPage.getByRole('slider', { name: 'Music volume' }).inputValue(), '20');
  assert.equal(await legacyPage.getByRole('slider', { name: 'Sound effects volume' }).inputValue(), '40');
  await legacyStorage.close();
  const blockedStorage = await browser.newContext();
  await blockedStorage.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
  });
  const blockedPage = await blockedStorage.newPage();
  await blockedPage.goto(url);
  await blockedPage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
  await blockedPage.getByRole('button', { name: 'Music settings', exact: true }).click();
  await blockedPage.getByRole('slider', { name: 'Music volume' }).fill('0');
  await blockedPage.getByText('Volume settings could not be saved in this host. Current volumes still apply.').waitFor();
  assert.equal(await blockedPage.getByRole('slider', { name: 'Music volume' }).inputValue(), '0');
  await blockedStorage.close();
  const airframeContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const airframePage = await airframeContext.newPage();
  airframePage.on('pageerror', error => errors.push(error.message));
  await airframePage.goto(url);
  for (const [label, tag] of [
    ['F-14 Tomcat', 'F-14'], ['F-15E Strike Eagle', 'F-15E'],
    ['F-22 Raptor', 'F-22'], ['Northrop YF-23 Black Widow II', 'YF-23'],
  ]) {
    await airframePage.getByRole('button', { name: label, exact: true }).click();
    await airframePage.getByRole('button', { name: /Flight school/ }).click();
    await airframePage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
    await airframePage.waitForFunction(name => document.querySelector('.flight-info .tag')?.textContent === name, tag);
    await airframePage.waitForTimeout(200);
    assert.equal(await airframePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await airframePage.getByRole('button', { name: 'Open mission briefing' }).click();
  }
  await airframeContext.close();
  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => { window.AudioContext = undefined; });
  const silentPage = await unsupported.newPage();
  silentPage.on('pageerror', error => errors.push(error.message));
  await silentPage.goto(url);
  await silentPage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
  await silentPage.getByRole('button', { name: 'Music settings', exact: true }).click();
  await silentPage.getByText('Music is unavailable in this host. Flight remains playable.').waitFor();
  await silentPage.getByText('Sound effects are unavailable in this host. Visual warnings remain active.').waitFor();
  assert.equal(await silentPage.getByRole('button', { name: 'ENABLE MUSIC', exact: true }).isDisabled(), true);
  assert.equal(await silentPage.locator('.modal-backdrop').count(), 0, 'Unsupported audio must not block flight');
  await unsupported.close();
  const stallContext = await browser.newContext();
  const stallPage = await stallContext.newPage();
  stallPage.on('pageerror', error => errors.push(error.message));
  await stallPage.goto(url);
  await stallPage.getByRole('button', { name: /Flight school/ }).click();
  await stallPage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
  await stallPage.locator('.modal-backdrop').waitFor({ state: 'hidden' });
  // Fly-by-wire holds a climb hands-off; bleed speed at idle, then pull through the alpha limit.
  await stallPage.keyboard.down('ControlLeft');
  await stallPage.keyboard.down('ArrowDown');
  await stallPage.waitForTimeout(2500);
  await stallPage.keyboard.up('ArrowDown');
  await stallPage.waitForTimeout(9500);
  await stallPage.keyboard.down('ArrowDown');
  await stallPage.waitForFunction(() => document.querySelector('.warning')?.textContent.includes('STALL'), null, { timeout: 60000 });
  await stallPage.waitForFunction(() => document.querySelector('.notification')?.textContent.includes('CORRECTION - Stall'));
  await stallPage.keyboard.up('ArrowDown');
  await stallPage.keyboard.up('ControlLeft');
  await stallPage.keyboard.press('t');
  await stallPage.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('STALL RECOVERY'));
  await stallPage.waitForFunction(() => document.querySelector('.autopilot-status')?.textContent.includes('LEVEL / SPD'), null, { timeout: 60000 });
  assert.equal(await stallPage.getByRole('heading', { name: 'Aircraft lost.' }).count(), 0, 'Stall recovery must preserve flight');
  await stallContext.close();
  console.log('Stall recovery passed: induced stall, keyboard engagement, aerodynamic recovery, safe mode transition');
  const crashContext = await browser.newContext();
  await crashContext.addInitScript(() => {
    window.crashAudioSources = [];
    window.crashAudioContexts = [];
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.crashAudioContexts.push(this); }
      createBufferSource() {
        const source = super.createBufferSource();
        window.crashAudioSources.push(source);
        return source;
      }
    };
  });
  const crashPage = await crashContext.newPage();
  crashPage.on('pageerror', error => errors.push(error.message));
  await crashPage.goto(url);
  await crashPage.getByRole('button', { name: /Flight school/ }).click();
  await crashPage.getByRole('button', { name: /LAUNCH SORTIE/ }).click();
  await crashPage.keyboard.down('ArrowUp');
  await crashPage.getByRole('heading', { name: 'Aircraft lost.' }).waitFor({ timeout: 60000 });
  await crashPage.keyboard.up('ArrowUp');
  const crashes = () => crashPage.evaluate(() => window.crashAudioSources.filter(source => !source.loop && Math.abs((source.buffer?.duration ?? 0) - 2.4) < 0.01).length);
  assert.equal(await crashes(), 1, 'Aircraft destruction must trigger exactly one crash sound');
  assert.equal(await crashPage.evaluate(() => window.crashAudioContexts[1].state), 'running', 'Crash tail must remain audible on results screen');
  await crashPage.waitForFunction(() => window.crashAudioContexts.every(context => context.state === 'suspended'));
  assert.equal(await crashes(), 1, 'The results screen must not retrigger the crash');
  await crashPage.getByRole('button', { name: /FLY AGAIN/ }).click();
  await crashPage.getByRole('heading', { name: 'Aircraft lost.' }).waitFor({ state: 'hidden' });
  await crashPage.keyboard.down('ArrowUp');
  await crashPage.getByRole('heading', { name: 'Aircraft lost.' }).waitFor({ timeout: 60000 });
  await crashPage.keyboard.up('ArrowUp');
  assert.equal(await crashes(), 2, 'A subsequent sortie must get a new crash sound');
  await crashPage.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await crashPage.evaluate(() => window.crashAudioContexts[1].state), 'running', 'Focus loss must not cancel the crash tail');
  await crashPage.waitForFunction(() => window.crashAudioContexts.every(context => context.state === 'suspended'));
  await crashContext.close();
  console.log('Crash audio passed: impact, one-shot tail, restart, and focus-loss continuity');
  assert.deepEqual(errors, [], 'No browser runtime or CSP errors');
} finally {
  await browser.close();
}

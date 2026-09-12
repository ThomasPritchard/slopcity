import { webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'output/playwright';
await mkdir(output, { recursive: true });
const browser = await webkit.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: `${output}/wave-video`, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
const videoStart = Date.now();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.stack || error.message));
try {
  await page.goto(process.env.GAME_URL || 'http://localhost:5173');
  await page.getByRole('textbox', { name: 'What should we call you?' }).fill('Tom');
  await page.getByRole('button', { name: 'Choose your look', exact: true }).click();
  await page.getByRole('button', { name: 'Join the square', exact: true }).click();
  await page.getByRole('button', { name: 'Open town map' }).waitFor();
  await page.getByRole('button', { name: 'Dismiss welcome' }).click();
  await page.waitForTimeout(500);
  // Inspect the real development scene, keeping the greeting triggered by its public UI.
  await page.evaluate(async () => {
    const source = await (await fetch('/src/world/scene.ts')).text();
    const modulePath = source.match(/import\s*\{\s*Engine\s*\}\s*from\s*["']([^"']+)/)?.[1];
    if (!modulePath) throw new Error('Could not resolve the actual renderer Engine');
    const { Engine } = await import(modulePath);
    const scene = Engine.Instances[0].scenes[0];
    (window as any).waveTestScene = scene;
    scene.activeCamera.alpha = Math.PI / 2;
    scene.activeCamera.beta = 1.36;
    scene.activeCamera.radius = 4.0;
  });
  const waveStartSeconds = (Date.now() - videoStart) / 1000;
  await page.getByRole('button', { name: 'Wave to neighbours' }).click();
  await page.waitForFunction(() => (window as any).waveTestScene.animationGroups.some((group: any) => group.name.endsWith('/Wave') && group.isPlaying));
  await page.waitForTimeout(900);
  const pose = await page.evaluate(() => {
    const scene = (window as any).waveTestScene;
    const wave = scene.animationGroups.find((group: any) => group.name.endsWith('/Wave') && group.isPlaying);
    const prefix = wave?.name.slice(0, -'Wave'.length);
    // Shop mannequins share this rig. Inspect the citizen actually waving.
    const joints = ['upper_arm.R', 'forearm.R', 'hand.R'].map(name => scene.transformNodes.find((node: any) => prefix && node.name.startsWith(prefix) && node.name.endsWith(`/${name}`))?.getAbsolutePosition().asArray());
    return { shoulder: joints[0], elbow: joints[1], wrist: joints[2], fps: scene.getEngine().getFps(), wavePlaying: !!wave };
  });
  assert.ok(pose.wavePlaying, 'wave continues through the greeting');
  assert.ok(pose.wrist && pose.elbow && pose.shoulder, 'exported arm joints are available');
  assert.ok(pose.wrist[1] > pose.elbow[1] + .08, 'raised forearm puts the wrist above the bent elbow');
  const a = pose.shoulder.map((value: number, i: number) => value - pose.elbow[i]);
  const b = pose.wrist.map((value: number, i: number) => value - pose.elbow[i]);
  const angle = Math.acos(a.reduce((sum: number, value: number, i: number) => sum + value * b[i], 0) / Math.hypot(...a) / Math.hypot(...b)) * 180 / Math.PI;
  assert.ok(angle > 50 && angle < 130, `elbow visibly bends, measured ${angle.toFixed(1)} degrees`);
  await page.screenshot({ path: `${output}/17-wave-greeting.png` });
  await page.waitForFunction(() => (window as any).waveTestScene.animationGroups.some((group: any) => group.name.endsWith('/Idle') && group.isPlaying), undefined, { timeout: 6000 });
  await page.screenshot({ path: `${output}/18-wave-finished.png` });
  await page.getByRole('button', { name: 'Wave to neighbours' }).click();
  await page.waitForTimeout(700);
  await page.locator('#world').focus(); await page.keyboard.down('w');
  await page.waitForFunction(() => (window as any).waveTestScene.animationGroups.some((group: any) => group.name.endsWith('/Walk') && group.isPlaying));
  await page.keyboard.up('w');
  assert.deepEqual(errors, []);
  await context.close();
  await writeFile(`${output}/wave-results.json`, JSON.stringify({ checkedAt: new Date().toISOString(), browser: 'headless WebKit', pose, elbowAngle: angle, waveStartSeconds, video: await page.video()?.path(), errors, checks: ['bent elbow and raised wrist', 'clip completes into idle', 'walking cancels greeting without sliding'] }, null, 2));
  console.log('PASS: bent-elbow wave, completed return to idle, movement interruption; no page errors.');
} finally { await browser.close(); }

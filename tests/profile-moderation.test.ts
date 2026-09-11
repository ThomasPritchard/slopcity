import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCKED_TERMS, BLOCKED_STEMS, ALLOWED_MILD } from '../shared/moderation-data.ts';
import { isBlockedProfileName, assertAllowedProfileName, BlockedProfileNameError } from '../shared/profileModeration.ts';

test('profile names share the existing severe-word policy, including disguised and numbered slurs',()=>{
 for (const name of [...BLOCKED_TERMS,...BLOCKED_STEMS]) assert.ok(isBlockedProfileName(name),name);
 for (const name of ['NIGGER10','n1gg3r','n\u200bigg\u200ber','n i g g e r','n_i_g_g_e_r','nіggеr','ＮＩＧＧＥＲ','niiiigger','another nigger']) {
  assert.ok(isBlockedProfileName(name));
  assert.throws(()=>assertAllowedProfileName(name),BlockedProfileNameError);
 }
});

test('profile checks cover the exact sanitised/truncated display name',()=>{
 assert.ok(isBlockedProfileName('ni<>gger'));
 assert.ok(isBlockedProfileName('a'.repeat(16)+'milfoil'));
});

test('ordinary names and the existing mild-language allowance are preserved',()=>{
 for (const name of ['Nigel','Kiki','Richard','Dick','Scunthorpe','Therapist','Diketone','Milfoil','DevToast',...ALLOWED_MILD]) {
  assert.equal(isBlockedProfileName(name),false,name);
  assert.doesNotThrow(()=>assertAllowedProfileName(name));
 }
});

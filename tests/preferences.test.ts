import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreferences,DEFAULT_PREFERENCES} from '../src/settings/preferences';
test('comfort preferences tolerate old or corrupt storage and constrain volume',()=>{
 assert.deepEqual(parsePreferences(null),DEFAULT_PREFERENCES);
 assert.deepEqual(parsePreferences({low:'true',motion:'unknown',effects:NaN,ambience:Infinity}),DEFAULT_PREFERENCES);
 assert.deepEqual(parsePreferences({low:true,motion:'reduced',effects:2,ambience:-1}),{low:true,motion:'reduced',effects:1,ambience:0});
});

import {describe,expect,it,vi} from 'vitest';
import mod from '../index.js';
describe('mod facade',()=>{it('registers only read-only commands and creates no runtime',()=>{const addCommand=vi.fn();mod({addCommand} as never);expect(addCommand).toHaveBeenCalledTimes(2);expect(addCommand.mock.calls.map(c=>c[0].name)).toEqual(['discord-status','discord-sessions']);});});

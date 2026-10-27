import fs from 'node:fs'
import {test,expect} from 'vitest'
import {validateCatalog} from '../support/bridge-catalog.mjs'
const fixture=()=>JSON.parse(fs.readFileSync(new URL('../fixtures/bridge-comparison/catalog.json',import.meta.url)))
test('all 115 cases map to assertions or explicit missing prerequisites',()=>expect(validateCatalog(fixture())).toBe(115))
test('H03 empty/duplicate/unknown expectation mutations cannot qualify',()=>{
 const empty=fixture();empty.scenarios=[];expect(()=>validateCatalog(empty)).toThrow('empty or incomplete')
 const duplicate=fixture();duplicate.scenarios[1].id=duplicate.scenarios[0].id;expect(()=>validateCatalog(duplicate)).toThrow('duplicate case')
 const unknown=fixture();unknown.scenarios[0].ignoreLoss=true;expect(()=>validateCatalog(unknown)).toThrow('unknown expectation')
 const unmapped=fixture();unmapped.scenarios[0].assertions=[];unmapped.scenarios[0].missing_prerequisites=[];expect(()=>validateCatalog(unmapped)).toThrow('unmapped')
})

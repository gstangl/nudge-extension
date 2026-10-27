import assert from 'node:assert/strict'
export function validateCatalog(catalog) {
  assert.equal(catalog.version,1,'unsupported catalog version')
  assert(Array.isArray(catalog.scenarios)&&catalog.scenarios.length===115,'empty or incomplete catalog')
  const ids=new Set(),counts={}
  const keys=['id','requirements','stimulus','expected','assertions','missing_prerequisites','coverage','execution']
  for(const c of catalog.scenarios){
    assert(Object.keys(c).every(k=>keys.includes(k)),'unknown expectation field')
    assert(/^[UPCRLMEBH]\d\d$/.test(c.id),'invalid case identity');assert(!ids.has(c.id),'duplicate case identity');ids.add(c.id)
    counts[c.id[0]]=(counts[c.id[0]]||0)+1
    assert(typeof c.expected==='string'&&c.expected.length>0,'missing independent expectation')
    assert(Array.isArray(c.assertions)&&Array.isArray(c.missing_prerequisites),'missing mapping')
    assert(c.assertions.length||c.missing_prerequisites.length,'unmapped scenario')
    assert(['mapped','partial','missing'].includes(c.coverage),'invalid coverage claim')
    assert.equal(c.execution,'not-run','catalog must not invent executed evidence')
  }
  assert.deepEqual(counts,{U:24,P:15,C:16,R:12,L:10,M:8,E:12,B:10,H:8},'unexpected family counts')
  return ids.size
}

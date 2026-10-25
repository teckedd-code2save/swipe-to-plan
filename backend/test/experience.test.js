import test from 'node:test';
import assert from 'node:assert/strict';
import {assessExperience,rerankForExperience} from '../src/experience.js';
import {parseItinerary} from '../src/itinerary.js';

const pizza={id:'pizza',name:'Pizza Corner',description:'Italian pizza and pasta',tagNames:['Italian'],score:.95,scoreComponents:{providerOrder:.95}};
const banku={id:'banku',name:'Banku Kitchen',description:'Serves banku, fufu and Ghanaian dishes',tagNames:['Ghanaian'],score:.35,scoreComponents:{providerOrder:.35}};

test('explicit Ghanaian cuisine raises sourced matches above unrelated provider ordering',()=>{
  const ranked=rerankForExperience([pizza,banku],{cuisine:'Ghanaian'},'dinner');
  assert.equal(ranked[0].id,'banku');
  assert.equal(ranked[0].experienceFit.cuisine.status,'provider_text_signal');
  assert.equal(ranked[1].experienceFit.cuisine.status,'unverified');
  assert.equal(ranked[1].experienceFit.cuisine.evidence,null);
});

test('the same cuisine cannot be assumed from a music preference or an unrelated stop',()=>{
  assert.equal(assessExperience(pizza,{cuisine:'Ghanaian'},'dinner').cuisine.status,'unverified');
  assert.equal(assessExperience(banku,{cuisine:'Ghanaian'},'coffee'),null);
  assert.equal(assessExperience(banku,{},'dinner'),null);
});

test('explicit user experience survives planning validation',()=>{
  const result=parseItinerary({area:'Kasoa, Ghana',activities:['dinner'],experience:{cuisine:'Ghanaian',atmosphere:'romantic',occasion:'birthday',notes:'Local dishes'}});
  assert.deepEqual(result.experience,{cuisine:'Ghanaian',atmosphere:'romantic',occasion:'birthday',notes:'Local dishes'});
  assert.throws(()=>parseItinerary({area:'Kasoa, Ghana',experience:{untrusted:true}}),/Unsupported experience/);
  assert.throws(()=>parseItinerary({area:'Kasoa, Ghana',experience:{cuisine:''}}),/cuisine/);
});

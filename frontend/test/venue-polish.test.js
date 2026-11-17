import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=file=>readFile(new URL(`../src/${file}`,import.meta.url),'utf8');
test('venue overview keeps detailed evidence in the practical tab and compact contact disclosure',async()=>{
 const code=await source('PlaceGuide.jsx');
 assert.doesNotMatch(code,/<VenueContact compact/); // Contact evidence lives in the manual enquiry, not repeated in overview.
 assert.doesNotMatch(code,/view!=='practical'&&<VenueMenuEvidence/);
 assert.doesNotMatch(code,/report\?\.error\|\|/);
 assert.match(code,/aria-label="Close place details" onClick=\{onClose\}><Icon name="close"/);
 assert.match(code,/view==='practical'&&<>[\s\S]*<VenueMenuEvidence place=\{place\}/);
 assert.match(code,/<div className="pg-sheet-header">/); // Avoid the app-wide header height/navigation rules.
 assert.match(code,/aria-label="Visit essentials"/);
 assert.match(code,/<summary>Full weekly schedule<\/summary>/);
 assert.doesNotMatch(code,/pg-photo/);
});
test('chat results omit blanket disclaimer but preserve specific warnings',async()=>{
 const code=await source('RecommendationPreview.jsx');
 assert.doesNotMatch(code,/cs-preview-limits/);
 assert.match(code,/preview.warnings.map/);
});
test('web mark follows native open-U geometry and typography',async()=>{
 const icons=await source('PlannerIcons.jsx'),css=await source('venue-polish.css');
 const native=await readFile(new URL('../../mobile/assets/brand/unstressed-mark.svg',import.meta.url),'utf8');
 const shape='M14 13v20c0 10.5 8 18 18 18s18-7.5 18-18v-5';
 assert.ok(icons.includes(shape)&&native.includes(shape));
 assert.match(css,/--font-display:var\(--font-body\)/);
});

test('shortlisted venues offer discovery without permitting form filling',async()=>{
 const code=await source('BookingAction.jsx');
 assert.match(code,/scope.allowed&&stop.id==='shortlist-place'\?<>[\s\S]*<ReservationFormPreview[^>]*fillAllowed=\{false\}/);
 assert.match(code,/You can find the form now. Add this place/);
});

test('chat summary retains specific warnings without repeating generic itinerary disclaimers',async()=>{
 const {resultPreview}=await import('../src/result-preview.js');
 const plan={phase:'discovery',stops:[{id:'one',item:{name:'A venue'}}],warnings:['Suggested times do not verify opening hours. Travel buffers are not route estimates.','Budget figures are allowances, not venue quotes. Confirm prices and availability before going.','The selected venue is closed on Tuesday.']};
 const result=resultPreview(plan);assert.deepEqual(result.warnings,['Visit times are not set.','The selected venue is closed on Tuesday.']);
});

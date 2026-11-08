import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

// Selector-declaration contracts, not computed style or a rendering substitute.
// Read relevant base/account styles before product-design's imported and own
// rules, as in production. Actual cascade/viewport QA is required on release.
async function stylesAt(width,height){
  const css=(await Promise.all(['styles.css','planner.css','chat-studio.css','account-tastes.css','getting-ready.css','journey-map.css','product-design.css'].map(file=>readFile(new URL(`../src/${file}`,import.meta.url),'utf8')))).join('\n').replace(/@import[^;]+;/g,'');
  const dom=new JSDOM(`<style>${css}</style>`),styles=new Map();
  function visit(rules){
    for(const rule of rules){
      if(rule.media){
        const query=rule.media.mediaText;
        if(/print|prefers-reduced-motion/.test(query))continue;
        const matches=[...query.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)].every(([,bound,axis,value])=>bound==='max'?(axis==='width'?width:height)<=Number(value):(axis==='width'?width:height)>=Number(value));
        if(matches)visit(rule.cssRules);
      }else if(rule.selectorText){
        for(const selector of rule.selectorText.split(',')){
          const declarations=styles.get(selector.trim())||{};
          for(let i=0;i<rule.style.length;i++){const property=rule.style[i];declarations[property]=rule.style.getPropertyValue(property);}
          styles.set(selector.trim(),declarations);
        }
      }
    }
  }
  visit(dom.window.document.styleSheets[0].cssRules);dom.window.close();return styles;
}

test('short narrow ready view releases inert chrome and duplicate sticky space without shrinking the map',async()=>{
  const styles=await stylesAt(321,391);
  assert.equal(styles.get('.chat-studio.ready-open > .cs-header')?.display,'none');
  assert.equal(styles.get('.chat-studio.ready-open .cs-day-panel.getting-ready-panel')?.top,'0');
  assert.equal(styles.get('.chat-studio.ready-open .getting-ready-panel .cs-day-header')?.padding,'0 12px');
  const back=styles.get('.chat-studio.ready-open .getting-ready-panel .cs-close-day');
  assert.equal(back?.width,'44px');assert.equal(back?.height,'44px');
  assert.equal(styles.get('.chat-studio.ready-open .getting-ready-panel .cs-day-tabs button')?.['min-height'],'44px');
  assert.equal(styles.get('.gr-next')?.position,'static');
  assert.equal(styles.get('.gr-hub .journey-map-canvas')?.height,'clamp(176px,33dvh,300px)');
  assert.equal(styles.get('.gr-hub .journey-map-fit')?.['min-height'],'44px');
  assert.ok(!['absolute','fixed','sticky'].includes(styles.get('.gr-hub .journey-map-tools')?.position),'Map tools must not cover pins, repeated-stop popups or attribution');
  assert.equal(styles.get('.gr-next>span')?.display,undefined,'Keep next-action guidance available in the scroll');
});

test('normal phone and desktop keep their header and sticky next action',async()=>{
  for(const [width,height] of [[375,533],[390,844],[1221,799],[800,391]]){
    const styles=await stylesAt(width,height);
    assert.equal(styles.get('.chat-studio.ready-open > .cs-header'),undefined);
    assert.equal(styles.get('.chat-studio.ready-open .cs-day-panel.getting-ready-panel'),undefined);
    assert.equal(styles.get('.gr-next')?.position,'sticky');
  }
});

test('very narrow global header retains all action buttons and compresses only the decorative wordmark',async()=>{
  const styles=await stylesAt(321,700);
  assert.equal(styles.get('.chat-studio .cs-header .cs-brand>span')?.display,'none');
  assert.equal(styles.get('.chat-studio .cs-header .cs-brand')?.['min-width'],'44px');
  assert.equal(styles.get('.chat-studio .cs-header .cs-icon-button')?.width,'44px');
  assert.equal(styles.get('.chat-studio .cs-header .cs-icon-button')?.height,'44px');
  assert.equal(styles.get('.chat-studio .cs-header .cs-view-day')?.['min-height'],'44px');
  assert.equal(styles.get('.chat-studio .cs-header .cs-account-button')?.['min-height'],'44px');
  assert.equal(styles.get('.chat-studio.day-open .cs-day-panel')?.top,'56px');
});

test('short sheets retain independent body scrolling and fixed-size header/footer',async()=>{
  const styles=await stylesAt(321,391);
  assert.equal(styles.get('.gr-sheet')?.['max-height'],'96dvh');
  assert.equal(styles.get('.gr-sheet-header')?.['flex-shrink'],'0');
  assert.equal(styles.get('.gr-sheet-footer')?.['flex-shrink'],'0');
  assert.equal(styles.get('.gr-sheet-scroll')?.['overflow-y'],'auto');
  assert.equal(styles.get('.gr-sheet-scroll')?.['min-height'],'0');
});

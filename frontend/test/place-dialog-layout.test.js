import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('short-height place dialogs use one scroller with sticky Close, without hiding navigation or actions',async()=>{
  const css=await readFile(new URL('../src/place-guide.css',import.meta.url),'utf8');
  const dom=new JSDOM(`<style>${css}</style>`);
  try{
    const rule=[...dom.window.document.styleSheets[0].cssRules].find(rule=>rule.conditionText==='(max-height:600px)');
    assert.ok(rule,'Keep a short-height rule for landscape phones and zoomed windows');
    const styles=new Map([...rule.cssRules].map(rule=>[rule.selectorText,rule.style]));
    assert.equal(styles.get('.pg-dialog[open]')?.display,'block');
    assert.equal(styles.get('.pg-dialog[open]')?.getPropertyValue('overflow-y'),'auto');
    assert.equal(styles.get('.pg-dialog .pg-dialog-scroll')?.overflow,'visible');
    assert.equal(styles.get('.pg-dialog .pg-dialog-top')?.position,'sticky');
    assert.equal(styles.get('.pg-dialog .pg-dialog-top')?.top,'0');
    assert.equal(styles.get('.pg-dialog .pg-dialog-bottom')?.position,'static');
    for(const [selector,style] of styles){
      assert.match(selector,/^\.pg-dialog(?:\[open\])?(?: |$)/,'Do not alter other planning dialogs');
      assert.notEqual(style.display,'none','Keep Close, tabs, selectors, and Done accessible');
      assert.notEqual(style.visibility,'hidden');
    }
  }finally{dom.window.close();}
});

// Exact provider signature. This adapter never presses Continue or submits a form.
export function inspectTableagentForms(){
 if(location.origin!=='https://tableagent.com')return [];
 const form=document.getElementById('findtableform');
 if(!form||form.tagName!=='FORM'||form.method.toLowerCase()!=='post'||form.action!==`${location.origin}${location.pathname}table-search/`)return [];
 const date=form.querySelector('#reservationdate[name=reservationdate]'),time=form.querySelector('select#reservationtime[name=reservationtime]'),party=form.querySelector('select#partysize[name=partysize]'),restaurant=form.elements.restaurant;
 if(!date||date.readOnly||!time||!party||!restaurant||!/^\d{1,10}$/.test(restaurant.value))return [];
 if([...form.querySelectorAll('input,select,textarea')].some(e=>e.required&&!['reservationdate','reservationtime','partysize','hours'].includes(e.name)&&e.type!=='hidden'))return [];
 return [{index:[...document.forms].indexOf(form),adapter:'tableagent-availability-v1',restaurantId:restaurant.value,action:form.action,method:'post',fields:[
 {id:'ta-date',elementIndex:0,name:'date',label:'Date',type:'date',required:true},
 {id:'ta-time',elementIndex:1,name:'time',label:'Time',type:'time',required:true},
 {id:'ta-party',elementIndex:2,name:'party',label:'Party size',type:'number',required:true}
 ]}];
}

// Product starting allowances in local units, NOT venue prices or FX rates.
// Unsupported currencies stay unset instead of inheriting cedi amounts.
const mealUnits={GHS:220,USD:30,GBP:25,EUR:30,JPY:4000,NGN:25000,KES:2000,ZAR:300,CAD:40,AUD:45};
export function suggestBudget(request) {
  const unit=mealUnits[request.currency],activities=request.activities||[];
  if(!unit||!activities.length)return null;
  const people=request.people||[];
  const style=people.length?people.reduce((sum,p)=>sum+({mindful:.75,balanced:1,treat:1.4}[p.spending?.style]||1),0)/people.length:1;
  const weight=activities.reduce((sum,key)=>sum+({coffee:.4,activity:.8,dinner:1,drinks:.5}[key]||0),0);
  const step=unit>=10000?1000:unit>=1000?100:unit>=100?50:5;
  return Math.ceil(unit*weight*(request.party.adults+request.party.children*.6)*style*1.25/step)*step;
}
export const budgetBasis='A starting allowance based on the activities, group size and spending styles, with room for transport and a buffer. These are planning amounts, not local price research or venue quotes.';

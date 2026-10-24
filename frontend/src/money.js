export const money=amount=>new Intl.NumberFormat('en',{maximumFractionDigits:0}).format(amount);
export const formatMoney=(amount,currency='GHS')=>`${currency==='GHS'?'GH₵':/^[A-Z]{3}$/.test(currency)?`${currency} `:'GHS '}${money(amount)}`;
export const CURRENCIES=Intl.supportedValuesOf('currency');

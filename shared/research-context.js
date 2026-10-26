// Research informs possible experience directions, not profession-to-taste rules.
export const CONTEXT_RESEARCH = [
  {id:'recovery-2007',title:'Recovery experiences',url:'https://doi.org/10.1037/1076-8998.12.3.204',summary:'Research distinguishes detachment, relaxation, mastery and control during non-work time. These are experience dimensions, not prescriptions for a particular activity.'},
  {id:'leisure-2020',title:'Leisure and need fulfillment',url:'https://doi.org/10.1111/aphw.12196',summary:'Day-reconstruction and diary research examines relaxation, autonomy, meaning, mastery and affiliation across leisure activities. Associations do not establish what an individual will prefer.'},
  {id:'activities-2001',title:'Work and recovery activities',url:'https://pubmed.ncbi.nlm.nih.gov/11482632/',summary:'A five-day diary study of 100 Dutch teachers examined low-effort, social and physical leisure. Its population and observational design limit generalization.'},
];
export const EXPERIENCE_GOALS = {
  unwind:{label:'Switch off and unwind',dimensions:['detachment','relaxation'],sources:['recovery-2007']},
  connect:{label:'Spend time with people',dimensions:['affiliation'],sources:['leisure-2020']},
  discover:{label:'A change of scene',dimensions:['mastery','autonomy'],sources:['recovery-2007','leisure-2020']},
  learn:{label:'Explore or make something',dimensions:['mastery'],sources:['recovery-2007']},
  move:{label:'Enjoy being active',dimensions:['physical activity'],sources:['activities-2001']},
};
export const INTEREST_TYPES = ['artist','book','brand','movie','podcast','place','tv_show','video_game','destination'];

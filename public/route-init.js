// Runs synchronously before first paint to show the right initial view.
// On the landing route (the deployment base — "/" or "/vN/"): the inline
// landing HTML remains visible. On all other routes: hide the landing HTML,
// show the loading spinner instead.
//
// Must match isLandingRoute() in src/entry.ts and shouldShowLanding() in
// src/main.ts. This is a static public/ file (not bundled), so it can't read
// import.meta.env.BASE_URL — instead it derives the deployment base from its
// OWN <script src>, which Vite prefixes with the base at build time
// (e.g. "/v1/route-init.js"). No-op at base "/".
(function(){
  var p=window.location.pathname;
  var q=window.location.search;
  var h=window.location.hash;
  var base='/';
  try{
    // currentScript is reliable for a classic sync <script src> like this one,
    // but fall back to a src-suffix lookup if it's ever null (defensive) so a
    // /vN/ deploy never misderives base='/' and flashes the spinner on landing.
    var sc=document.currentScript||document.querySelector('script[src$="route-init.js"]');
    var s=sc&&sc.src;
    if(s){var bp=new URL(s).pathname.replace(/route-init\.js$/,'');if(bp)base=bp;}
  }catch(e){/* keep base="/" */}
  // Base-stripped route (mirrors appRoute): the base itself maps to "/".
  var route;
  if(p===base||p===base.replace(/\/$/,'')){route='/';}
  else if(base!=='/'&&p.indexOf(base)===0){route='/'+p.slice(base.length);}
  else{route=p===''?'/':p;}
  var isLanding=
    route==='/'&&
    !h.startsWith('#share=')&&
    q.indexOf('view=')<0&&
    q.indexOf('session=')<0&&
    q.indexOf('gallery')<0&&
    q.indexOf('versions')<0&&
    q.indexOf('images')<0&&
    q.indexOf('diff')<0&&
    q.indexOf('notes')<0&&
    q.indexOf('data')<0;
  if(!isLanding){
    var li=document.getElementById('landing-inline');
    var ls=document.getElementById('loading-splash');
    if(li)li.style.display='none';
    if(ls)ls.style.display='flex';
  }
})();

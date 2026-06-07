// Runs synchronously before first paint to show the right initial view.
// On / (landing route): the inline landing HTML remains visible.
// On all other routes: hide the landing HTML, show the loading spinner instead.
(function(){
  var p=window.location.pathname;
  var q=window.location.search;
  var h=window.location.hash;
  var isLanding=
    (p==='/'||p==='')&&
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

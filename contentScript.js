// Poll + observe timetable directly in page
(() => {
  const SEL = ".session-info-container ul li.course-red-wrapper";
  let last = "";

  function scrape() {
    const items = Array.from(document.querySelectorAll(SEL));
    const sessions = items.map(li=>{
      const title=li.querySelector("b")?.textContent.trim()||"";
      const courseLine=li.querySelector("span[style]")?.textContent.trim()||"";
      const timeText=li.querySelector("p")?.textContent.trim()||"";
      const room=li.querySelector(".session-venue-info b")?.textContent.replace(/\(.*\)/,"").trim()||"";
      return {title,courseLine,timeText,room};
    });
    const s=JSON.stringify(sessions);
    if(s!==last){
      last=s;
      window.__UPES_TIMETABLE=sessions;
      chrome.runtime.sendMessage({action:"timetableUpdated"});
    }
  }

  // respond to popup
  chrome.runtime.onMessage.addListener((req,sender,sendResponse)=>{
    if(req.action==="getTimetable"){scrape();sendResponse({sessions:window.__UPES_TIMETABLE||[]});}
  });

  // observe + poll
  const obs=new MutationObserver(scrape);
  if(document.body)obs.observe(document.body,{childList:true,subtree:true});
  setInterval(scrape,1000);
  setTimeout(scrape,800);
})();

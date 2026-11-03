(async()=>{const d=(ms)=>new Promise(r=>setTimeout(r,ms));await d(1200);document.querySelectorAll('.inline-notice,.update-banner,.toast').forEach(e=>e.remove());return {ok:true}})()

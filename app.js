const ANILIST_API="https://graphql.anilist.co";
const DB_NAME="AnimeHistoryDB", DB_VERSION=2;
const seasons=["winter","spring","summer","fall"];
const seasonNames={winter:"Hiver",spring:"Printemps",summer:"Été",fall:"Automne"};
const seasonKey=(year,season)=>`${year}-${season}`;
const seasonEntryKey=(year,season,id)=>`${seasonKey(year,season)}:${id}`;
const FIRST_ANIME_YEAR=1940;

function currentSeason(){
  const month=new Date().getMonth();
  return seasons[Math.floor(month/3)];
}

const views=["season","years","favorites","browse"];
function initialStateFromUrl(){
  const params=new URLSearchParams(window.location.search);
  const year=Number(params.get("year"));
  const season=params.get("season");
  const view=params.get("view");
  return {
    year:Number.isInteger(year)&&year>0?year:new Date().getFullYear(),
    season:seasons.includes(season)?season:currentSeason(),
    view:views.includes(view)?view:"season"
  };
}
function syncUrlState(){
  const url=new URL(window.location.href);
  url.searchParams.set("view",state.view);
  url.searchParams.set("year",String(state.year));
  url.searchParams.set("season",state.season);
  history.replaceState(history.state,"",url);
}

let db, bulkSyncCancelled=false;
let searchTitles=[], visibleSuggestions=[], activeSuggestion=-1;
let state={...initialStateFromUrl(),anime:[],sort:"priority"};

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const key=(y,s)=>`${y}-${s}`;
const dislikeIcon='<svg class="dislike-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H3.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 5.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-4.27a2 2 0 0 0-1.93 1.48l-.6 2.22a3 3 0 0 1-2.9 2.3 2.3 2.3 0 0 1-2.3-2.88Z"/></svg>';

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=event=>{const d=r.result;
      if(!d.objectStoreNames.contains("anime"))d.createObjectStore("anime",{keyPath:"mal_id"});
      const seasonStore=d.objectStoreNames.contains("seasons")
        ?r.transaction.objectStore("seasons")
        :d.createObjectStore("seasons",{keyPath:"key"});
      if(!d.objectStoreNames.contains("user"))d.createObjectStore("user",{keyPath:"mal_id"});
      if(!d.objectStoreNames.contains("meta"))d.createObjectStore("meta",{keyPath:"key"});
      if(event.oldVersion<2&&event.oldVersion>0){
        const legacyEntries=[];
        const cursorRequest=seasonStore.openCursor();
        cursorRequest.onsuccess=()=>{
          const cursor=cursorRequest.result;
          if(!cursor){
            for(const {oldKey,entry} of legacyEntries){
              seasonStore.delete(oldKey);
              seasonStore.put({...entry,key:seasonEntryKey(entry.year,entry.season,entry.mal_id),
                seasonKey:seasonKey(entry.year,entry.season)});
            }
            return;
          }
          const entry=cursor.value;
          if(Number.isFinite(entry.year)&&entry.season&&Number.isFinite(entry.mal_id)){
            legacyEntries.push({oldKey:cursor.primaryKey,entry});
          }
          cursor.continue();
        };
      }
    };
    r.onsuccess=()=>{db=r.result;resolve(db)};r.onerror=()=>reject(r.error);
  });
}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
function put(store,v){return new Promise((res,rej)=>{let r=tx(store,"readwrite").put(v);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function get(store,k){return new Promise((res,rej)=>{let r=tx(store).get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function all(store){return new Promise((res,rej)=>{let r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function del(store,k){return new Promise((res,rej)=>{let r=tx(store,"readwrite").delete(k);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

async function fetchJSON(url, options={}, attempts=4){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(url,{cache:"no-store",...options});
      const text=await response.text();
      let body=null;
      try{body=text?JSON.parse(text):null}catch{}
      if(response.ok)return body;
      const message=body?.message||body?.errors?.[0]?.message||text.slice(0,180);
      const error=new Error(`HTTP ${response.status}${message?` — ${message}`:""}`);
      error.status=response.status;
      if(![408,429,500,502,503,504].includes(response.status)||attempt===attempts)throw error;
      lastError=error;
    }catch(error){
      lastError=error;
      if(error.status&&!([408,429,500,502,503,504].includes(error.status))||attempt===attempts)throw error;
    }
    await sleep(1000*Math.pow(2,attempt-1)+Math.random()*400);
  }
  throw lastError||new Error("Erreur réseau");
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function normalizeAniList(a){
  const malId=Number(a.idMal);
  const datePart=date=>date?.year&&date?.month&&date?.day
    ?`${date.year}-${String(date.month).padStart(2,"0")}-${String(date.day).padStart(2,"0")}`:null;
  return {
    mal_id:malId,url:`https://myanimelist.net/anime/${malId}`,
    title:a.title?.romaji||a.title?.english||a.title?.native||"Titre inconnu",
    title_english:a.title?.english||null,title_japanese:a.title?.native||null,
    images:a.coverImage?.extraLarge||a.coverImage?.large||a.coverImage?.medium||"",
    type:a.format||null,source:null,episodes:a.episodes??null,status:a.status||null,
    score:a.averageScore?Math.round(a.averageScore)/10:null,scored_by:null,rank:null,
    popularity:a.popularity??null,members:null,favorites:a.favourites??null,
    synopsis:a.description||null,background:null,premiered:null,broadcast:"",duration:null,rating:null,
    studios:(a.studios?.nodes||[]).map(studio=>studio.name),genres:a.genres||[],
    aired_from:datePart(a.startDate),aired_to:datePart(a.endDate),
    dataSource:"AniList",scoreSource:"AniList",updatedAt:new Date().toISOString()
  };
}

async function fetchAniListSeason(year,season){
  const query=`query ($page:Int,$season:MediaSeason,$year:Int) {
    Page(page:$page,perPage:50) {
      pageInfo { hasNextPage }
      media(type:ANIME,season:$season,seasonYear:$year,isAdult:false,sort:POPULARITY_DESC) {
        idMal title { romaji english native } coverImage { extraLarge large medium }
        season seasonYear
        format episodes status averageScore popularity favourites description(asHtml:false)
        genres studios(isMain:true) { nodes { name } } startDate { year month day } endDate { year month day }
      }
    }
  }`;
  const seasonEnum=season.toUpperCase();
  const anime=[];
  let page=1,hasNext=true;
  while(hasNext){
    const result=await fetchAniListPage(query,{page,season:seasonEnum,year});
    const pageData=result?.data?.Page;
    if(!pageData)throw new Error("Réponse AniList invalide.");
    const media=pageData.media||[];
    if(page===1&&media.length&&media.every(item=>item.seasonYear!==year||item.season!==seasonEnum)){
      const error=new Error(`AniList a renvoyé une autre année que ${year} pour ${seasonNames[season]}.`);
      error.retryable=false;
      throw error;
    }
    anime.push(...media.filter(item=>item.seasonYear===year&&item.season===seasonEnum&&item.idMal).map(normalizeAniList));
    hasNext=Boolean(pageData.pageInfo?.hasNextPage);
    page++;
    if(hasNext)await sleep(1200);
  }
  if(!anime.length){
    const error=new Error(`AniList n'a fourni aucun anime avec identifiant MAL pour ${year} ${seasonNames[season]}.`);
    error.retryable=false;
    throw error;
  }
  return anime;
}

async function fetchAniListPage(query,variables){
  let lastError;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const result=await fetchJSON(ANILIST_API,{
        method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({query,variables})
      },2);
      if(result?.errors?.length){
        const detail=result.errors[0];
        const error=new Error(detail.message||"Erreur GraphQL AniList");
        error.status=detail.extensions?.status||detail.status;
        error.retryable=[408,429,500,502,503,504].includes(Number(error.status))||/rate.?limit|too many requests|temporar|internal server|timeout/i.test(error.message);
        throw error;
      }
      return result;
    }catch(error){
      lastError=error;
      const retryable=error.retryable??(!error.status||[408,429,500,502,503,504].includes(Number(error.status)));
      if(!retryable||attempt===4)throw error;
      await sleep(Math.min(15000,1500*Math.pow(2,attempt-1))+Math.random()*500);
    }
  }
  throw lastError||new Error("AniList ne répond pas.");
}

async function saveSeason(year,season,anime){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(["anime","seasons","meta"],"readwrite");
    const animeStore=transaction.objectStore("anime");
    const seasonStore=transaction.objectStore("seasons");
    const metaStore=transaction.objectStore("meta");
    const request=seasonStore.getAll();
    request.onsuccess=()=>{
      const key=seasonKey(year,season);
      for(const entry of request.result){
        if(entry.seasonKey===key||(!entry.seasonKey&&entry.year===year&&entry.season===season)){
          seasonStore.delete(entry.key);
        }
      }
      for(const item of anime){
        animeStore.put(item);
        seasonStore.put({key:seasonEntryKey(year,season,item.mal_id),seasonKey:key,year,season,mal_id:item.mal_id});
      }
      metaStore.put({key,lastRefresh:new Date().toISOString(),count:anime.length,
        dataSource:anime[0]?.dataSource||"AniList"});
    };
    request.onerror=()=>transaction.abort();
    transaction.oncomplete=resolve;
    transaction.onerror=()=>reject(transaction.error||new Error("Échec d'enregistrement IndexedDB."));
    transaction.onabort=()=>reject(transaction.error||new Error("Enregistrement local annulé."));
  });
}

async function downloadSeason(year,season,statusPrefix="",maxAttempts=1){
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      setStatus(`${statusPrefix}Récupération AniList : ${year} ${seasonNames[season]}${attempt>1?` (tentative ${attempt}/${maxAttempts})`:""}…`);
      const anime=await fetchAniListSeason(year,season);
      return {anime,dataSource:"AniList"};
    }catch(error){
      if(error.retryable===false||attempt===maxAttempts)throw error;
      setStatus(`${statusPrefix}AniList temporairement indisponible : ${error.message}. Nouvelle tentative…`,"warn");
      await sleep(Math.min(20000,4000*Math.pow(2,attempt-1))+Math.random()*1000);
    }
  }
  throw new Error("Impossible de récupérer cette saison sur AniList.");
}

async function refreshSeason(year,season){
  const button=$("#refreshBtn");
  if(button.disabled)return;
  button.disabled=true;
  try{
    const result=await downloadSeason(year,season);
    await saveSeason(year,season,result.anime);
    await populateYearOptions();
    setStatus(`Actualisation terminée : ${result.anime.length} anime enregistrés depuis ${result.dataSource}.`,"ok");
    await loadSeason();
  }catch(error){
    setStatus(`Échec de l’actualisation : ${error.message}. La copie locale précédente a été conservée.`,"error");
  }finally{
    button.disabled=false;
  }
}

async function refreshAllSeasons(){
  const startYear=FIRST_ANIME_YEAR;
  const seasonIndex=seasons.indexOf(currentSeason());
  const endYear=new Date().getFullYear();
  const tasks=[];
  for(let year=startYear;year<=endYear;year++){
    const lastSeason=year===endYear?seasonIndex:seasons.length-1;
    for(let index=0;index<=lastSeason;index++)tasks.push({year,season:seasons[index]});
  }
  if(!window.confirm(`L’actualisation va parcourir ${tasks.length} saisons, de ${startYear} à ${endYear}. Cela peut prendre plusieurs minutes. Continuer ?`))return;

  bulkSyncCancelled=false;
  let completed=0,animeCount=0,failed=[];
  $("#refreshAllBtn").hidden=true;
  $("#cancelBulkBtn").hidden=false;
  $("#refreshBtn").disabled=true;
  try{
    for(const [index,task] of tasks.entries()){
      if(bulkSyncCancelled)break;
      setStatus(`Actualisation globale : saison ${index+1}/${tasks.length} (${task.year} ${seasonNames[task.season]})…`);
      try{
        const progress=`Actualisation globale ${index+1}/${tasks.length} : `;
        const result=await downloadSeason(task.year,task.season,progress,3);
        await saveSeason(task.year,task.season,result.anime);
        animeCount+=result.anime.length;
        completed++;
      }catch(error){
        failed.push(`${task.year} ${seasonNames[task.season]}: ${error.message}`);
      }
      if(!bulkSyncCancelled&&index<tasks.length-1)await sleep(1500);
    }
    const stopped=bulkSyncCancelled?" Actualisation arrêtée après la saison en cours.":"";
    const failureText=failed.length?` ${failed.length} saison(s) en échec; leurs données locales précédentes sont conservées. Échecs : ${failed.slice(0,5).join("; ")}${failed.length>5?"; …":""}`:"";
    setStatus(`Actualisation globale terminée : ${completed}/${tasks.length} saisons, ${animeCount} anime synchronisés.${stopped}${failureText}`,failed.length?"warn":"ok");
    await populateYearOptions();
    await loadSeason();
  }finally{
    $("#refreshAllBtn").hidden=false;
    $("#cancelBulkBtn").hidden=true;
    $("#refreshBtn").disabled=false;
  }
}

function navigateSeason(offset){
  let index=state.year*seasons.length+seasons.indexOf(state.season)+offset;
  state.year=Math.floor(index/seasons.length);
  state.season=seasons[((index%seasons.length)+seasons.length)%seasons.length];
  if(![...$("#yearSelect").options].some(option=>Number(option.value)===state.year)){
    $("#yearSelect").add(new Option(String(state.year),String(state.year)));
  }
  $("#yearSelect").value=String(state.year);
  $("#seasonSelect").value=state.season;
  loadSeason();
}

function sortAnime(list,users){
  const weight=anime=>{
    const user=users.get(anime.mal_id)||{};
    if(user.favorite)return 5;
    if(user.liked)return 4;
    if(user.watched&&!user.disliked)return 3;
    if(user.disliked)return 2;
    if(user.watchlist)return 1;
    return 0;
  };
  return [...list].sort((left,right)=>{
    if(state.sort==="priority"){
      const priority=weight(right)-weight(left);
      if(priority)return priority;
    }
    if(state.sort==="title")return (left.title||"").localeCompare(right.title||"");
    if(state.sort==="popularity")return (right.popularity||0)-(left.popularity||0)||(right.score||0)-(left.score||0);
    return (right.score||0)-(left.score||0)||(left.rank||Infinity)-(right.rank||Infinity);
  });
}

function setStatus(message,type=""){
  const status=$("#status");
  status.className=`status${type?` ${type}`:""}`;
  status.textContent=message;
}

async function loadSeason(){
  const rows=await all("seasons");
  const ids=[...new Set(rows.filter(x=>x.year===state.year&&x.season===state.season).map(x=>x.mal_id))];
  state.anime=[];
  for(const id of ids){const a=await get("anime",id);if(a)state.anime.push(a)}
  state.anime.sort((a,b)=>(a.rank||999999)-(b.rank||999999));
  await updateSuggestions();
  render();
}

async function userFor(id){return await get("user",id)||{mal_id:id,watched:false,favorite:false,liked:false,disliked:false,watchlist:false,personalRank:null,notes:""}}
async function toggle(id,field){
  const scrollY=window.scrollY;
  const u=await userFor(id);u[field]=!u[field];
  if(u[field]&&["favorite","liked","disliked"].includes(field))u.watched=true;
  await put("user",u);await render();
  window.scrollTo(0,scrollY);
}
function matchesSearch(a){
  const q=$("#searchInput").value.trim().toLowerCase();
  return !q||[a.title,a.title_english,a.title_japanese].filter(Boolean).some(x=>x.toLowerCase().includes(q));
}
function filterState(){
  const ids={watched:"onlyWatched",favorite:"onlyFav",liked:"onlyLiked",disliked:"onlyDisliked",watchlist:"onlyWatchlist"};
  return Object.entries(ids).filter(([,id])=>$("#"+id).checked).map(([field])=>field);
}
function matchesFilters(a,user,mode="and"){
  if(!matchesSearch(a))return false;
  const fields=filterState();
  if(!fields.length)return true;
  return mode==="or"?fields.some(field=>user[field]):fields.every(field=>user[field]);
}
function configureViewFilters(view){
  const defaults=view==="years"?["watched","favorite","disliked"]:[];
  const ids={watched:"onlyWatched",favorite:"onlyFav",liked:"onlyLiked",disliked:"onlyDisliked",watchlist:"onlyWatchlist"};
  Object.entries(ids).forEach(([field,id])=>$("#"+id).checked=defaults.includes(field));
}
async function updateSuggestions(){
  searchTitles=[...new Set((await all("anime")).flatMap(a=>[a.title,a.title_english,a.title_japanese].filter(Boolean)))].sort((a,b)=>a.localeCompare(b));
  activeSuggestion=-1;
  renderSuggestions();
}
function closeSuggestions(){
  const list=$("#titleSuggestions");
  list.hidden=true;
  list.replaceChildren();
  $("#searchInput").setAttribute("aria-expanded","false");
}
function renderSuggestions(){
  const input=$("#searchInput"),list=$("#titleSuggestions");
  if(document.activeElement!==input){closeSuggestions();return}
  const query=input.value.trim().toLocaleLowerCase();
  visibleSuggestions=searchTitles.filter(title=>title.toLocaleLowerCase().includes(query)).slice(0,12);
  list.replaceChildren();
  if(!visibleSuggestions.length){closeSuggestions();return}
  visibleSuggestions.forEach((title,index)=>{
    const option=document.createElement("button");
    option.type="button";
    option.className="autocomplete-option";
    option.title=title;
    option.setAttribute("role","option");
    option.setAttribute("aria-selected",String(index===activeSuggestion));
    option.textContent=title;
    option.addEventListener("mousedown",event=>event.preventDefault());
    option.addEventListener("click",()=>{
      input.value=title;
      closeSuggestions();
      render();
    });
    list.appendChild(option);
  });
  list.hidden=false;
  input.setAttribute("aria-expanded","true");
}
async function render(){
  syncUrlState();
  $("#yearSelect").value=state.year;$("#seasonSelect").value=state.season;
  $("#seasonHeading").textContent=`${seasonNames[state.season]} ${state.year}`;
  const users=await all("user"), um=new Map(users.map(x=>[x.mal_id,x]));
  const watched=state.anime.filter(a=>um.get(a.mal_id)?.watched),fav=state.anime.filter(a=>um.get(a.mal_id)?.favorite),watchlisted=state.anime.filter(a=>um.get(a.mal_id)?.watchlist);
  const shown=state.anime.filter(a=>matchesFilters(a,um.get(a.mal_id)||{}));
  $("#seasonStats").innerHTML=`<span><b>${state.anime.length}</b> anime</span><span><b>${watched.length}</b> vus</span><span><b>${fav.length}</b> favoris</span><span><b>${watchlisted.length}</b> à voir</span>`;
  document.querySelectorAll("[data-sort]").forEach(button=>button.classList.toggle("active",button.dataset.sort===state.sort));
  document.querySelectorAll(".tab").forEach(button=>button.classList.toggle("active",button.dataset.view===state.view));
  ["seasonView","yearsView","favoritesView","browseView"].forEach(id=>$("#"+id).hidden=true);
  if(state.view==="season"){await renderGrid($("#grid"),sortAnime(shown,um),um);$("#seasonView").hidden=false}
  if(state.view==="years"){await renderYears(um);$("#yearsView").hidden=false}
  if(state.view==="favorites"){const fa=(await all("anime")).filter(a=>um.get(a.mal_id)?.favorite);await renderGrid($("#favGrid"),sortAnime(fa,um),um);$("#favoritesView").hidden=false}
  if(state.view==="browse"){const browse=(await all("anime")).filter(a=>matchesFilters(a,um.get(a.mal_id)||{},"or"));await renderGrid($("#browseGrid"),sortAnime(browse,um),um);$("#browseView").hidden=false}
}
async function renderGrid(el,list,um){
  if(!list.length){el.innerHTML='<div class="empty">Aucun anime dans cette vue.</div>';return}
  el.innerHTML="";
  for(const a of list){
    const u=um.get(a.mal_id)||{};
    const d=document.createElement("article");d.className="anime";
    d.innerHTML=`<img class="poster" src="${esc(a.images)}" alt="" loading="lazy">
      <div class="card-body"><div class="title">${esc(a.title)}</div>
      <div class="sub">${esc(a.type||"")} · ${a.episodes??"?"} ép. · <span class="star">★ ${a.score??"—"}</span></div>
      <div class="badges">${a.dataSource==="AniList"?'<span class="badge">AniList</span>':""}${u.favorite?'<span class="badge star">★ Favori</span>':""}${u.liked?'<span class="badge">♥ Like</span>':""}${u.disliked?`<span class="badge">${dislikeIcon} Dislike</span>`:""}${u.watched?'<span class="badge">✓ Vu</span>':""}${u.watchlist?'<span class="badge">À voir</span>':""}</div>
      <div class="controls"><button class="iconbtn watched ${u.watched?"on":""}">${u.watched?"✓ Vu":"☐ Vu"}</button><button class="iconbtn fav ${u.favorite?"on":""}" title="Favori">${u.favorite?"★":"☆"}</button><button class="iconbtn like ${u.liked?"on":""}" title="Like">♥</button><button class="iconbtn dislike ${u.disliked?"on":""}" title="Dislike">${dislikeIcon}</button><button class="iconbtn watchlist ${u.watchlist?"on":""}">${u.watchlist?"À voir ✓":"À voir +"}</button></div></div>`;
    d.querySelector(".poster").onclick=()=>openDetail(a);
    d.querySelector(".title").onclick=()=>openDetail(a);
    d.querySelector(".watched").onclick=()=>toggle(a.mal_id,"watched");
    d.querySelector(".fav").onclick=()=>toggle(a.mal_id,"favorite");
    d.querySelector(".like").onclick=()=>toggle(a.mal_id,"liked");
    d.querySelector(".dislike").onclick=()=>toggle(a.mal_id,"disliked");
    d.querySelector(".watchlist").onclick=()=>toggle(a.mal_id,"watchlist");
    el.appendChild(d);
  }
}
async function renderYears(um){
  const rows=await all("seasons"),grouped=new Map();
  for(const row of rows){
    const anime=await get("anime",row.mal_id),user=um.get(row.mal_id)||{};
    if(anime&&matchesFilters(anime,user,"or")){
      if(!grouped.has(row.year))grouped.set(row.year,new Map());
      grouped.get(row.year).set(anime.mal_id,anime);
    }
  }
  const years=[...grouped.keys()].sort((a,b)=>b-a);
  $("#years").innerHTML=years.length?years.map(year=>`<div class="year-block"><div class="year-title">${year}</div><div class="year-grid" data-year="${year}"></div></div>`).join(""):'<div class="empty">Aucun anime tagué pour ces critères.</div>';
  for(const year of years)await renderGrid($(`.year-grid[data-year="${year}"]`),sortAnime([...grouped.get(year).values()],um),um);
}
function openDetail(a){
  $("#modalContent").innerHTML=`<div class="detail"><img src="${esc(a.images)}"><div>
  <h2>${esc(a.title)}</h2><div class="sub">${esc(a.title_english||"")} ${a.score?`· ★ ${a.score} (${a.scored_by||0})`:""}<br>Données : ${esc(a.dataSource||"AniList")}${a.scoreSource?` · note ${esc(a.scoreSource)}`:""}</div>
  <p>${esc(a.synopsis||"Synopsis indisponible.")}</p>
  <div class="badges">${[a.type,a.status,a.episodes?`${a.episodes} épisodes`:null,a.premiered,...a.genres].filter(Boolean).map(x=>`<span class="badge">${esc(x)}</span>`).join("")}</div>
  <p class="sub">Studios : ${esc((a.studios||[]).join(", ")||"—")}<br>Diffusion : ${esc(a.broadcast||"—")}</p>
  <div class="links"><button id="mdWatched">✓ Vu</button><button id="mdFav">★ Favori</button><button id="mdLike">♥ Like</button><button id="mdDislike">${dislikeIcon} Dislike</button><button id="mdWatchlist">À voir</button><a class="button" href="${esc(a.url)}" target="_blank" rel="noopener">Ouvrir MAL</a></div>
  </div></div>`;
  $("#modal").hidden=false;
  $("#mdWatched").onclick=()=>toggle(a.mal_id,"watched");
  $("#mdFav").onclick=()=>toggle(a.mal_id,"favorite");
  $("#mdLike").onclick=()=>toggle(a.mal_id,"liked");
  $("#mdDislike").onclick=()=>toggle(a.mal_id,"disliked");
  $("#mdWatchlist").onclick=()=>toggle(a.mal_id,"watchlist");
}
async function exportData(){
  const payload={version:1,exportedAt:new Date().toISOString(),anime:await all("anime"),seasons:await all("seasons"),user:await all("user"),meta:await all("meta")};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`anime-history-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
}
async function importData(file){
  const p=JSON.parse(await file.text());
  if(!p||!Array.isArray(p.anime)||!Array.isArray(p.seasons)||!Array.isArray(p.user))throw Error("Export invalide");
  for(const a of p.anime)await put("anime",a);for(const x of p.seasons)await put("seasons",x);for(const u of p.user)await put("user",u);for(const m of (p.meta||[]))await put("meta",m);
  await populateYearOptions();
  await loadSeason();
}

async function populateYearOptions(){
  const current=new Date().getFullYear();
  const rows=await all("seasons");
  const storedYears=rows.map(row=>Number(row.year)).filter(Number.isFinite);
  const firstYear=Math.min(FIRST_ANIME_YEAR,...storedYears);
  const years=new Set(storedYears);
  for(let year=firstYear;year<=current;year++)years.add(year);
  years.add(current);
  $("#yearSelect").innerHTML=[...years].sort((a,b)=>b-a).map(year=>`<option value="${year}">${year}</option>`).join("");
}

async function init(){
  await openDB();
  await populateYearOptions();
  $("#seasonSelect").innerHTML=seasons.map(s=>`<option value="${s}">${seasonNames[s]}</option>`).join("");
  $("#yearSelect").value=state.year;$("#seasonSelect").value=state.season;
  $("#yearSelect").onchange=async e=>{state.year=+e.target.value;await loadSeason()};
  $("#seasonSelect").onchange=async e=>{state.season=e.target.value;await loadSeason()};
  const searchInput=$("#searchInput");
  searchInput.oninput=()=>{activeSuggestion=-1;renderSuggestions();render()};
  searchInput.onfocus=renderSuggestions;
  searchInput.onblur=closeSuggestions;
  searchInput.onkeydown=event=>{
    if(event.key==="Escape"){closeSuggestions();return}
    if(event.key==="ArrowDown"||event.key==="ArrowUp"){
      if(!visibleSuggestions.length)return;
      event.preventDefault();
      const direction=event.key==="ArrowDown"?1:-1;
      activeSuggestion=activeSuggestion<0
        ?(direction>0?0:visibleSuggestions.length-1)
        :(activeSuggestion+direction+visibleSuggestions.length)%visibleSuggestions.length;
      renderSuggestions();
    }
    if(event.key==="Enter"&&activeSuggestion>=0){
      event.preventDefault();
      searchInput.value=visibleSuggestions[activeSuggestion];
      closeSuggestions();
      render();
    }
  };
  ["onlyWatched","onlyFav","onlyLiked","onlyDisliked","onlyWatchlist"].forEach(id=>$("#"+id).onchange=render);
  $("#refreshBtn").onclick=()=>refreshSeason(state.year,state.season);
  $("#refreshAllBtn").onclick=refreshAllSeasons;
  $("#cancelBulkBtn").onclick=()=>{bulkSyncCancelled=true;setStatus("Arrêt demandé; la saison en cours sera terminée avant l’arrêt.","warn")};
  $("#previousSeason").onclick=()=>navigateSeason(-1);$("#nextSeason").onclick=()=>navigateSeason(1);
  document.querySelectorAll("[data-sort]").forEach(button=>button.onclick=()=>{state.sort=button.dataset.sort;render()});
  $("#exportBtn").onclick=exportData;$("#importFile").onchange=e=>e.target.files[0]&&importData(e.target.files[0]).catch(x=>alert(x.message));
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.view=b.dataset.view;configureViewFilters(state.view);render()});
  $("#closeModal").onclick=()=>$("#modal").hidden=true;$("#modal").querySelector(".modal-backdrop").onclick=()=>$("#modal").hidden=true;
  configureViewFilters(state.view);
  await updateSuggestions();
  await loadSeason();
}
init().catch(e=>$("#status").textContent=e.message);

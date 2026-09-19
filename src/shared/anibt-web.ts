import type { ThemeMode } from './types.ts'

export const ANIBT_WEB_ORIGIN = 'https://anibt.net'

export function isAnibtWebUrl(value: string): boolean {
  try { return new URL(value).origin === ANIBT_WEB_ORIGIN } catch { return false }
}

/** A CAPTCHA/clearance cookie or HTTP 200 alone is not an authenticated session. */
export function hasAnibtWebSession(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const { user, session } = value as { user?: { id?: unknown }; session?: { id?: unknown } }
  return typeof user?.id === 'string' && !!user.id && typeof session?.id === 'string' && !!session.id
}

/** Keep AniBT's real widget, origin, React form and ticket exchange intact.
 * Only presentation changes: the account page supplies the credential fields.
 */
export function anibtChallengeScript(): string {
  return `(()=>{
    if(location.origin!==${JSON.stringify(ANIBT_WEB_ORIGIN)}||location.pathname!=='/auth/sign-in')return false;
    if(!document.querySelector('cap-widget')||!customElements.get('cap-widget')||(window.$_TSR&&!window.$_TSR.hydrated))return false;
    if(!document.getElementById('abp-inline-challenge')){
      const style=document.createElement('style');style.id='abp-inline-challenge';
      style.textContent=\`
        html,body { margin:0!important; padding:0!important; min-height:0!important; overflow:hidden!important; }
        body *:not(cap-widget):not(cap-widget *):not(:has(cap-widget)):not([data-sonner-toaster]):not([data-sonner-toaster] *):not(:has([data-sonner-toaster])) { display:none!important; }
        body :has(cap-widget) { display:block!important; position:static!important; width:auto!important; height:auto!important; min-height:0!important; margin:0!important; padding:0!important; border:0!important; box-shadow:none!important; background:transparent!important; transform:none!important; }
        /* cap-widget renders its control in Shadow DOM. max-content collapses the
           host before the shadow tree has measurable content, leaving only a 1px
           line. Give it a real box so the site's own widget can paint. */
        cap-widget { display:block!important; width:300px!important; min-width:280px!important; height:64px!important; min-height:64px!important; max-width:calc(100% - 24px)!important; margin:12px auto!important; }
        /* Error messages sit below the control, never across its click target. */
        [data-sonner-toaster] { position:static!important; width:auto!important; height:auto!important; margin:0 12px!important; padding:0!important; }
        [data-sonner-toast] { position:relative!important; inset:auto!important; width:100%!important; height:auto!important; transform:none!important; margin:4px 0!important; }
      \`;
      document.head.appendChild(style);
    }
    const widget=document.querySelector('cap-widget');
    let bottom=widget.getBoundingClientRect().bottom+12;
    for(const toast of document.querySelectorAll('[data-sonner-toaster], [data-sonner-toast]')){
      if(toast.textContent.trim())bottom=Math.max(bottom,toast.getBoundingClientRect().bottom+8);
    }
    return Math.ceil(bottom);
  })()`
}

/** AniBT's own theme contract: theme storage key, light/dark classes and inline palette. */
export function anibtThemeScript(mode: ThemeMode): string {
  return `(()=>{
    if(location.origin!==${JSON.stringify(ANIBT_WEB_ORIGIN)})return;
    const mode=${JSON.stringify(mode)};
    window.__abpThemeObserver?.disconnect();
    const root=document.documentElement;
    const bg=mode==='dark'?'#17101a':'#fffbfc';
    const fg=mode==='dark'?'#f6eef1':'#3a1020';
    const old=localStorage.getItem('theme');localStorage.setItem('theme',mode);
    if(old!==mode)window.dispatchEvent(new StorageEvent('storage',{key:'theme',oldValue:old,newValue:mode,storageArea:localStorage}));
    const apply=()=>{
      window.__abpThemeObserver?.disconnect();
      root.classList.remove(mode==='dark'?'light':'dark');root.classList.add(mode);
      root.style.colorScheme=mode;root.style.backgroundColor=bg;root.style.color=fg;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content',bg);
      window.__abpThemeObserver.observe(root,{attributes:true,attributeFilter:['class','style']});
    };
    window.__abpThemeObserver=new MutationObserver(apply);apply();
  })()`
}

/** Fill React's controlled inputs through the native setter, then submit after real CAPTCHA success. */
export function anibtLoginScript(email: string, password: string): string {
  return `(()=>{
    if(location.origin!==${JSON.stringify(ANIBT_WEB_ORIGIN)}||location.pathname!=='/auth/sign-in')return;
    if(window.__abpLoginInstalled)return;window.__abpLoginInstalled=true;
    const fill=()=>{
      if(window.$_TSR&&!window.$_TSR.hydrated)return false;
      const email=document.querySelector('input[name=email]');
      const password=document.querySelector('input[name=password]');
      if(!email||!password)return false;
      const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      for(const [input,value] of [[email,${JSON.stringify(email)}],[password,${JSON.stringify(password)}]]){
        set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      return true;
    };
    let attempts=0;const timer=setInterval(()=>{if(fill()||++attempts>=75)clearInterval(timer)},200);
    // This listener never solves or bypasses the challenge. It waits for the site's real solve event.
    document.addEventListener('solve',event=>{
      if(event.target?.tagName!=='CAP-WIDGET'||!event.detail?.token)return;
      setTimeout(()=>{
        if(location.pathname==='/auth/sign-in')document.querySelector('button[data-testid="sign-in-submit"]')?.click();
      },0);
    },true);
  })()`
}

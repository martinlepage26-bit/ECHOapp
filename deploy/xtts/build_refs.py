import json, numpy as np, soundfile as sf, pyloudnorm as pyln
SR=24000
T=json.load(open("work/transcripts.json"))
def seg(src, start, end):
    a,_=sf.read(f"work/{src}.wav")
    # snap to word boundaries from whisper and pad lightly
    words=[w for s in T[src]["segments"] for w in s["words"] if w[1]>=start-0.05 and w[2]<=end+0.05]
    s0=max(0,words[0][1]-0.06); s1=words[-1][2]+0.10
    x=a[int(s0*SR):int(s1*SR)]
    # trim low-energy edges (20 ms frames, -45 dBFS)
    f=int(0.02*SR); e=[20*np.log10(np.sqrt(np.mean(x[i:i+f]**2))+1e-9) for i in range(0,len(x)-f,f)]
    on=[i for i,v in enumerate(e) if v>-45]
    x=x[max(0,on[0]-2)*f:(on[-1]+3)*f]
    fade=int(0.01*SR); x=x.copy(); x[:fade]*=np.linspace(0,1,fade); x[-fade:]*=np.linspace(1,0,fade)
    return x, "".join(w[0] for w in words).strip()
def norm(x):
    m=pyln.Meter(SR); x=pyln.normalize.loudness(x, m.integrated_loudness(x), -20.0)
    return np.clip(x,-0.98,0.98)
def build(name, parts):
    gap=np.zeros(int(0.2*SR)); xs=[]; texts=[]
    for p in parts:
        x,t=seg(*p); xs.append(norm(x)); texts.append(t)
    y=norm(np.concatenate([v for x in xs for v in (x,gap)][:-1]))
    sf.write(f"voices/{name}.wav", y, SR, subtype="PCM_16")
    meta={"voice":name,"duration_s":round(len(y)/SR,2),"ref_text":" ".join(texts),"parts":[{"source":p[0],"start":p[1],"end":p[2]} for p in parts]}
    json.dump(meta, open(f"voices/{name}.json","w"), indent=1); print(meta)
build("echo",   [("echo-reference-original",0.0,6.48)])
build("martin", [("martin-sample-2",83.76,84.78),("martin-sample-3",33.16,40.06),("echo-reference-original",18.52,21.88)])
build("martin-s3only", [("martin-sample-3",33.16,40.06)])

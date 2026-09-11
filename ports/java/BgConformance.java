// BehaviorGuard core - port acuan Java (nol dependensi, JDK saja).
//
// Implementasi keempat dari core/SPEC.md (setelah JS, Python, Rust). Membuktikan
// kontrak numerik BehaviorGuard lintas-bahasa: angka SAMA dengan yang lain dari
// core/golden.json yang sama, toleransi 1e-9. JVM => Android/Kotlin/Scala ikut tercakup.
//
//   java BgConformance.java [path/ke/golden.json]   (default: ../../core/golden.json)
//
// Struktur mengikuti bg_core.py. mulberry32 memakai int 32-bit (wrap alami) + >>>.

import java.nio.file.*;
import java.util.*;

public class BgConformance {

    // ============================ Parser JSON minimal ============================
    static final class JP {
        final char[] b; int i;
        JP(String s){ b = s.toCharArray(); i = 0; }
        void ws(){ while(i<b.length && Character.isWhitespace(b[i])) i++; }
        Object parse(){
            ws(); char c=b[i];
            if(c=='{') return obj();
            if(c=='[') return arr();
            if(c=='"') return str();
            if(c=='t'){ i+=4; return Boolean.TRUE; }
            if(c=='f'){ i+=5; return Boolean.FALSE; }
            if(c=='n'){ i+=4; return null; }
            return num();
        }
        Map<String,Object> obj(){
            LinkedHashMap<String,Object> m=new LinkedHashMap<>();
            i++; ws();
            if(b[i]=='}'){ i++; return m; }
            while(true){
                ws(); String k=str(); ws(); i++; // :
                Object v=parse(); m.put(k,v); ws();
                char c=b[i++]; if(c=='}') break;
            }
            return m;
        }
        List<Object> arr(){
            ArrayList<Object> a=new ArrayList<>();
            i++; ws();
            if(b[i]==']'){ i++; return a; }
            while(true){
                a.add(parse()); ws();
                char c=b[i++]; if(c==']') break;
            }
            return a;
        }
        String str(){
            StringBuilder sb=new StringBuilder(); i++; // opening "
            while(b[i]!='"'){
                if(b[i]=='\\'){
                    i++; char e=b[i];
                    switch(e){
                        case 'n': sb.append('\n'); break;
                        case 't': sb.append('\t'); break;
                        case 'r': sb.append('\r'); break;
                        default: sb.append(e);
                    }
                    i++;
                } else sb.append(b[i++]);
            }
            i++; // closing "
            return sb.toString();
        }
        Double num(){
            int start=i;
            while(i<b.length){
                char c=b[i];
                if(c=='-'||c=='+'||c=='.'||c=='e'||c=='E'||(c>='0'&&c<='9')) i++;
                else break;
            }
            return Double.parseDouble(new String(b,start,i-start));
        }
    }

    // ============================ Konstanta normatif ============================
    static final int N_ESTIMATORS=100, MAX_SAMPLES=256, SEED=42, GATE_SVM=20;
    static final double W_IF=0.30, W_SVM=0.70, Q_LOW=0.10, Q_MED=0.033; // detektor-2=Mahalanobis
    static final double K_LOW=1.75, K_MED_EXTRA=2.0, MAHA_SHRINK=0.3;   // C-33: K_LOW 3,3 -> 1,75    // kalibrasi parametrik + shrink
    static final double STD_FLOOR_EPS=1e-9, STD_FLOOR_VALUE=1.0;
    static final double SCORE_STD_MIN=1e-3, SCORE_STD_MAX=10.0, Z_CLAMP=6.0;

    static final String[] F4 = {
        "mouse_velocity_mean","mouse_velocity_std","mouse_velocity_max",
        "mouse_acceleration_std","mouse_curvature_mean","mouse_direction_changes",
        "mouse_pause_count","mouse_click_interval_mean","cursor_idle_ratio",
        "cross_mouse_keyboard_coordination","keystroke_dwell_time_mean",
        "keystroke_dwell_time_std","keystroke_flight_time_mean",
        "keystroke_transition_entropy","keystroke_typing_speed",
        "keystroke_cross_field_cadence","keystroke_burst_count",
        "temporal_time_of_day_score","temporal_session_duration",
        "temporal_activity_bursts","nav_page_transition_pattern","nav_scroll_depth_mean",
        "nav_page_count","nav_step_transition_count","form_focus_count","form_blur_count",
        "form_field_switch_rate","cart_action_count",
        "keystroke_flight_median","keystroke_flight_iqr","keystroke_backspace_ratio",
        "keystroke_cross_hand_ratio","keystroke_dwell_median","keystroke_shift_ratio"
    };

    // ============================ PRNG mulberry32 ============================
    static final class Rng {
        int a;
        Rng(int seed){ a=seed; }
        double next(){
            a += 0x6D2B79F5;                       // int wrap = mod 2^32
            int t = a;
            t = (t ^ (t >>> 15)) * (t | 1);
            t ^= t + (t ^ (t >>> 7)) * (t | 61);
            return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
        }
    }

    static double cFactor(int n){
        if(n<=1) return 0.0;
        if(n==2) return 1.0;
        return 2*(Math.log(n-1)+0.5772156649) - 2.0*(n-1)/n;
    }

    // ============================ Statistik ============================
    static double[][] computeStats(double[][] X){
        int d=X[0].length; double n=X.length;
        double[] mean=new double[d];
        for(double[] v:X) for(int i=0;i<d;i++) mean[i]+=v[i];
        for(int i=0;i<d;i++) mean[i]/=n;
        double[] var=new double[d];
        for(double[] v:X) for(int i=0;i<d;i++){ double diff=v[i]-mean[i]; var[i]+=diff*diff; }
        for(int i=0;i<d;i++) var[i]/=n;
        double[] std=new double[d];
        for(int i=0;i<d;i++) std[i]= (Math.sqrt(var[i])<STD_FLOOR_EPS)? STD_FLOOR_VALUE : Math.sqrt(var[i]);
        return new double[][]{mean,std};
    }
    static double[] standardize(double[] v, double[] mean, double[] std){
        double[] o=new double[v.length];
        for(int i=0;i<v.length;i++) o[i]=(v[i]-mean[i])/std[i];
        return o;
    }
    static double[] scoreStats(double[] s){
        double n=s.length, m=0; for(double v:s) m+=v; m/=n;
        double var=0; for(double v:s) var+=(v-m)*(v-m); var/=n;
        double sd=Math.sqrt(var);
        if(!Double.isFinite(sd)||sd<SCORE_STD_MIN) sd=SCORE_STD_MIN;
        if(sd>SCORE_STD_MAX) sd=SCORE_STD_MAX;
        return new double[]{m,sd};
    }
    static double zScore(double val, double[] st){
        double z=(val-st[0])/st[1];
        return Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));
    }

    // ============================ Isolation Forest ============================
    static final class Node {
        boolean leaf; int size, feat; double split; Node left,right;
    }
    static final class IForest {
        Node[] trees; double c;
        IForest(double[][] X){
            int nFeatures=X[0].length;
            int n=Math.min(MAX_SAMPLES, X.length);
            c=cFactor(n);
            Rng rng=new Rng(SEED);
            int maxDepth = n>1 ? (int)Math.ceil(Math.log(n)/Math.log(2)) : 0;
            trees=new Node[N_ESTIMATORS];
            for(int e=0;e<N_ESTIMATORS;e++){
                int[] idx=new int[X.length];
                for(int k=0;k<X.length;k++) idx[k]=k;
                for(int i=idx.length-1;i>0;i--){
                    int j=(int)(rng.next()*(i+1));
                    int tmp=idx[i]; idx[i]=idx[j]; idx[j]=tmp;
                }
                double[][] sample=new double[n][];
                for(int k=0;k<n;k++) sample[k]=X[idx[k]];
                trees[e]=build(sample,0,maxDepth,nFeatures,rng);
            }
        }
        Node build(double[][] pts,int depth,int maxDepth,int nf,Rng rng){
            Node nd=new Node();
            if(depth>=maxDepth || pts.length<=1){ nd.leaf=true; nd.size=pts.length; return nd; }
            int feat=(int)(rng.next()*nf);
            double mn=pts[0][feat], mx=pts[0][feat];
            for(double[] p:pts){ if(p[feat]<mn) mn=p[feat]; if(p[feat]>mx) mx=p[feat]; }
            if(mn==mx){ nd.leaf=true; nd.size=pts.length; return nd; }
            double split=mn+rng.next()*(mx-mn);
            ArrayList<double[]> L=new ArrayList<>(), R=new ArrayList<>();
            for(double[] p:pts){ if(p[feat]<split) L.add(p); else R.add(p); }
            if(L.isEmpty()||R.isEmpty()){ nd.leaf=true; nd.size=pts.length; return nd; }
            nd.leaf=false; nd.feat=feat; nd.split=split;
            nd.left=build(L.toArray(new double[0][]),depth+1,maxDepth,nf,rng);
            nd.right=build(R.toArray(new double[0][]),depth+1,maxDepth,nf,rng);
            return nd;
        }
        double path(double[] x, Node nd, int depth){
            if(nd.leaf) return depth+cFactor(nd.size);
            Node nxt = x[nd.feat]<nd.split ? nd.left : nd.right;
            return path(x,nxt,depth+1);
        }
        double scoreOne(double[] x){
            if(trees.length==0) return 0.0;
            double avg=0; for(Node t:trees) avg+=path(x,t,0); avg/=trees.length;
            double anom = c!=0 ? Math.pow(2,-avg/c) : 0.5;
            return 0.5-anom;
        }
    }

    // ============================ OC-SVM ============================
    static final class Ocsvm {
        double gamma; double[] mean; double threshold;
        Ocsvm(double[][] X,int nFeatures){
            int d=X[0].length; mean=new double[d];
            for(double[] v:X) for(int i=0;i<d;i++) mean[i]+=v[i];
            for(int i=0;i<d;i++) mean[i]/=X.length;
            gamma=1.0/nFeatures;
            double[] scores=new double[X.length];
            for(int k=0;k<X.length;k++) scores[k]=raw(X[k]);
            Arrays.sort(scores);
            int idx=(int)(scores.length*0.10);
            double val = idx<scores.length ? scores[idx] : 0.0;
            threshold = val!=0.0 ? val : 0.0;
        }
        double raw(double[] x){
            double d2=0; for(int i=0;i<x.length;i++){ double t=x[i]-mean[i]; d2+=t*t; }
            return Math.exp(-gamma*d2);
        }
        double scoreOne(double[] x){ return raw(x)-threshold-0.1; }
    }

    // ===================== Mahalanobis + shrinkage diagonal =====================
    // Detektor-2 baru. Bit-identik bg_core.py: -sqrt((x-mu)^T Sigma^-1 (x-mu)).
    static final class Mahalanobis {
        double[] mean; double[][] inv;
        Mahalanobis(double[][] X, double shrink){
            int n=X.length, d=X[0].length;
            mean=new double[d];
            for(double[] v:X) for(int i=0;i<d;i++) mean[i]+=v[i];
            for(int i=0;i<d;i++) mean[i]/=n;
            double[][] cov=new double[d][d];
            for(double[] v:X){
                double[] dv=new double[d];
                for(int i=0;i<d;i++) dv[i]=v[i]-mean[i];
                for(int i=0;i<d;i++){ double di=dv[i]; for(int j=0;j<d;j++) cov[i][j]+=di*dv[j]; }
            }
            double denom = n>1 ? (n-1) : 1;
            for(int i=0;i<d;i++) for(int j=0;j<d;j++) cov[i][j]/=denom;
            double mu=0; for(int i=0;i<d;i++) mu+=cov[i][i]; mu/=d;
            for(int i=0;i<d;i++){
                for(int j=0;j<d;j++) cov[i][j]=(1-shrink)*cov[i][j]+(i==j?shrink*mu:0.0);
                cov[i][i]+=1e-6;
            }
            inv=inv(cov,d);
        }
        // Gauss-Jordan pivot-parsial; urutan operasi float dijaga identik.
        static double[][] inv(double[][] a, int d){
            double[][] m=new double[d][2*d];
            for(int i=0;i<d;i++){ for(int j=0;j<d;j++) m[i][j]=a[i][j]; m[i][d+i]=1.0; }
            for(int col=0;col<d;col++){
                int piv=col; double best=Math.abs(m[col][col]);
                for(int r=col+1;r<d;r++){ if(Math.abs(m[r][col])>best){ best=Math.abs(m[r][col]); piv=r; } }
                if(Math.abs(m[piv][col])<1e-12) m[piv][col]=1e-12;
                if(piv!=col){ double[] t=m[col]; m[col]=m[piv]; m[piv]=t; }
                double pv=m[col][col];
                for(int k=0;k<2*d;k++) m[col][k]/=pv;
                for(int r=0;r<d;r++){
                    if(r!=col && m[r][col]!=0.0){
                        double f=m[r][col];
                        for(int k=0;k<2*d;k++) m[r][k]-=f*m[col][k];
                    }
                }
            }
            double[][] out=new double[d][d];
            for(int i=0;i<d;i++) for(int j=0;j<d;j++) out[i][j]=m[i][d+j];
            return out;
        }
        double scoreOne(double[] x){
            int d=x.length; double[] dv=new double[d];
            for(int i=0;i<d;i++) dv[i]=x[i]-mean[i];
            double m2=0;
            for(int i=0;i<d;i++){ double t=0; for(int j=0;j<d;j++) t+=inv[i][j]*dv[j]; m2+=dv[i]*t; }
            return -Math.sqrt(m2>0?m2:0);
        }
    }

    // ============================ Ensemble ============================
    static final class Ensemble {
        IForest iff; Mahalanobis det2; double[] ifStats, svmStats; double gIf, gSvm;
        Ensemble(IForest iff, Mahalanobis det2, double[][] Xstd, int n){
            this.iff=iff; this.det2=det2;
            double[] ifs=new double[Xstd.length], svs=new double[Xstd.length];
            for(int i=0;i<Xstd.length;i++){ ifs[i]=iff.scoreOne(Xstd[i]); svs[i]=det2.scoreOne(Xstd[i]); }
            ifStats=scoreStats(ifs); svmStats=scoreStats(svs);
            double svm = n<GATE_SVM ? 0.0 : W_SVM;
            double s = W_IF+svm;
            if(s<=0){ gIf=W_IF; gSvm=W_SVM; } else { gIf=W_IF/s; gSvm=svm/s; }
        }
        double scoreOne(double[] x){
            double zIf=zScore(iff.scoreOne(x), ifStats);
            double zSvm=zScore(det2.scoreOne(x), svmStats);
            if(gSvm==0.0) return zIf;
            return gIf*zIf + gSvm*zSvm;
        }
    }

    // ============================ Ambang & vonis ============================
    static double quantile(double[] sorted, double q){
        if(sorted.length==0) return -0.4;
        double idx=q*(sorted.length-1);
        int lo=(int)Math.floor(idx), hi=(int)Math.ceil(idx);
        if(lo==hi) return sorted[lo];
        double frac=idx-lo;
        return sorted[lo]*(1-frac)+sorted[hi]*frac;
    }
    static double[] calibrateThresholds(double[] baseScores){
        double[] s=baseScores.clone(); Arrays.sort(s);
        double low=quantile(s,Q_LOW), med=quantile(s,Q_MED);
        if(low-med<0.15) med=low-0.25;
        low=Math.max(-3.0,Math.min(1.0,low));
        med=Math.max(-3.0,Math.min(low-0.05,med));
        return new double[]{low,med};
    }
    // Kalibrasi PARAMETRIK: low = mean - K_LOW*std; MEDIUM lebih ketat. Bit-identik bg_core.py.
    static double[] calibrateThresholdsParametric(double[] baseScores){
        int n=baseScores.length;
        if(n==0) return new double[]{-0.4,-0.8};
        double m=0; for(double x:baseScores) m+=x; m/=n;
        double var=0; for(double x:baseScores) var+=(x-m)*(x-m); var/=n;
        double sd = var>1e-12 ? Math.sqrt(var) : 1.0;
        return new double[]{m-K_LOW*sd, m-(K_LOW+K_MED_EXTRA)*sd};
    }
    static String toRisk(double score,double low,double med){
        if(score<=med) return "HIGH";
        if(score<=low) return "MEDIUM";
        return "LOW";
    }
    static String toAction(String level){
        // HIGH tunggal -> step-up (bukan block). Block keras = aturan-run di lapisan SDK.
        if(level.equals("HIGH")) return "REQUIRE_STEPUP";
        if(level.equals("MEDIUM")) return "REQUIRE_MFA";
        return "ALLOW_SESSION";
    }
    static String topFeature(double[] xstd, List<String> names){
        int best=0; double ba=Math.abs(xstd[0]);
        for(int i=1;i<xstd.length;i++){ if(Math.abs(xstd[i])>ba){ ba=Math.abs(xstd[i]); best=i; } }
        return names.get(best);
    }

    // ============================ Ekstraksi fitur (SPEC sec.8) ============================
    @SuppressWarnings("unchecked")
    static Map<String,Object> M(Object o){ return (Map<String,Object>)o; }
    @SuppressWarnings("unchecked")
    static List<Object> A(Object o){ return (List<Object>)o; }

    static double num(Map<String,Object> e,String k){
        Object v=e.get(k);
        if(v instanceof Double d && Double.isFinite(d)) return d;
        return 0.0;
    }
    static boolean hasNum(Map<String,Object> e,String k){ return e.get(k) instanceof Double; }
    static String sstr(Map<String,Object> e,String k){
        Object v=e.get(k); return v instanceof String s ? s : "";
    }
    static String etype(Map<String,Object> e){ return sstr(e,"event_type"); }
    static double mean(List<Double> a){ if(a.isEmpty()) return 0.0; double s=0; for(double v:a) s+=v; return s/a.size(); }
    static double std(List<Double> a){
        if(a.isEmpty()) return 0.0; double m=mean(a),s=0; for(double v:a) s+=(v-m)*(v-m); return Math.sqrt(s/a.size());
    }
    static double safe(double v){ return Double.isFinite(v)? v : 0.0; }

    // ---- SPEC 1.4 (C-44): ritme ketik. Padanan keyClass()/keystrokeRhythm() di features.js.
    static final String HAND_L="qwertasdfgzxcvb", HAND_R="yuiophjklnm";
    static String keyClass(Map<String,Object> e){
        Object kc=e.get("kc");
        if(kc instanceof String s && !s.isEmpty()) return s;
        Object ko=e.get("key");
        if(!(ko instanceof String k)) return "O";
        if(k.length()==1 && k.charAt(0)<128){
            char c=k.charAt(0); if(c>='A' && c<='Z') c=(char)(c+32);
            if(HAND_L.indexOf(c)>=0) return "L";
            if(HAND_R.indexOf(c)>=0) return "R";
            if(c>='0' && c<='9') return "D";
            if(c==' ') return "S";
            return "P";
        }
        if(k.equals("Backspace") || k.equals("Delete")) return "E";
        if(k.equals("Shift")) return "H";
        return "O";
    }
    static double median(List<Double> a){
        if(a.isEmpty()) return 0.0;
        List<Double> b=new ArrayList<>(a); Collections.sort(b); int m=b.size()/2;
        return b.size()%2==1 ? b.get(m) : (b.get(m-1)+b.get(m))/2;
    }
    static void keystrokeRhythm(List<Map<String,Object>> keyEv, HashMap<String,Double> out){
        List<Double> fl=new ArrayList<>(), same=new ArrayList<>(), cross=new ArrayList<>(), dw=new ArrayList<>();
        double back=0, shift=0, letters=0;
        for(int i=0;i<keyEv.size();i++){
            Map<String,Object> e=keyEv.get(i); String c=keyClass(e);
            if(c.equals("E")) back++;
            if(c.equals("H")) shift++;
            if(c.equals("L") || c.equals("R")) letters++;
            if(hasNum(e,"hold_time")){ double h=(Double)e.get("hold_time"); if(h>0 && h<1000) dw.add(h); }
            if(i>0){
                Map<String,Object> p=keyEv.get(i-1);
                double dt=num(e,"timestamp")-num(p,"timestamp");
                if(dt>0 && dt<1000){
                    fl.add(dt);
                    String pc=keyClass(p);
                    if((pc.equals("L")||pc.equals("R")) && (c.equals("L")||c.equals("R"))) (pc.equals(c)? same : cross).add(dt);
                }
            }
        }
        double iqr=0;
        if(fl.size()>3){ List<Double> b=new ArrayList<>(fl); Collections.sort(b);
            iqr=b.get((int)Math.floor(b.size()*0.75))-b.get((int)Math.floor(b.size()*0.25)); }
        double ms=median(same), mc=median(cross);
        out.put("keystroke_flight_median",safe(median(fl)));
        out.put("keystroke_flight_iqr",safe(iqr));
        out.put("keystroke_backspace_ratio",safe(keyEv.isEmpty()? 0 : back/keyEv.size()));
        out.put("keystroke_cross_hand_ratio",safe(ms>0 && mc>0 ? mc/ms : 0));
        out.put("keystroke_dwell_median",safe(median(dw)));
        out.put("keystroke_shift_ratio",safe(letters>0 ? shift/letters : 0));
    }

    static double[] extractFeatures(List<Object> rawEvents, double sessionStartTs){
        List<Map<String,Object>> events=new ArrayList<>();
        for(Object o:rawEvents) events.add(M(o));
        if(events.isEmpty()) return new double[F4.length];

        List<Map<String,Object>> mouseMove=new ArrayList<>(), mouseClick=new ArrayList<>(),
            mouseScroll=new ArrayList<>(), keyEv=new ArrayList<>(), focusEv=new ArrayList<>(),
            blurEv=new ArrayList<>(), navEv=new ArrayList<>();
        for(Map<String,Object> e:events){
            String t=etype(e);
            switch(t){
                case "MOUSE_MOVE": mouseMove.add(e); break;
                case "MOUSE_CLICK": mouseClick.add(e); break;
                case "MOUSE_SCROLL": mouseScroll.add(e); break;
                case "KEYSTROKE": keyEv.add(e); break;
                case "FORM_FOCUS": focusEv.add(e); break;
                case "FORM_BLUR": blurEv.add(e); break;
                case "NAVIGATION": case "PAGE_STEP": navEv.add(e); break;
                default: break;
            }
        }
        List<Map<String,Object>> mouseEv=new ArrayList<>();
        mouseEv.addAll(mouseMove); mouseEv.addAll(mouseClick); mouseEv.addAll(mouseScroll);

        List<Double> velocities=new ArrayList<>(), accelerations=new ArrayList<>(), curvatures=new ArrayList<>();
        double pauses=0, directionChanges=0; Double lastDir=null;
        for(int i=1;i<mouseEv.size();i++){
            Map<String,Object> p=mouseEv.get(i-1), c=mouseEv.get(i);
            double dt=num(c,"timestamp")-num(p,"timestamp");
            if(dt<=0) continue;
            double dx=num(c,"x")-num(p,"x"), dy=num(c,"y")-num(p,"y");
            double dist=Math.hypot(dx,dy);
            double v=dist/dt; velocities.add(v);
            if(dist>0){
                double dr=Math.atan2(dy,dx);
                if(lastDir!=null && Math.abs(dr-lastDir)>Math.PI/4+1e-9) directionChanges++;   // SPEC 1.3 (C-34)
                lastDir=dr;
            }
            if(velocities.size()>1){
                double a=(v-velocities.get(velocities.size()-2))/dt; accelerations.add(a);
            }
            if(i>=2){
                Map<String,Object> p2=mouseEv.get(i-2);
                double x0=num(p2,"x"),y0=num(p2,"y"),x1=num(p,"x"),y1=num(p,"y"),x2=num(c,"x"),y2=num(c,"y");
                double area=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);
                double sa=Math.hypot(x1-x0,y1-y0), sb=Math.hypot(x2-x1,y2-y1), sc=Math.hypot(x2-x0,y2-y0);
                if(sa*sb*sc>0) curvatures.add(Math.abs(4*area/(sa*sb*sc)));
            }
            if(dt>100) pauses++;
        }
        List<Double> clickIntervals=new ArrayList<>();
        for(int i=1;i<mouseClick.size();i++)
            clickIntervals.add(num(mouseClick.get(i),"timestamp")-num(mouseClick.get(i-1),"timestamp"));

        double cursorIdle=0;
        if(!mouseMove.isEmpty()){
            int idle=0; for(Map<String,Object> e:mouseMove) if(num(e,"velocity")<0.5) idle++;
            cursorIdle=(double)idle/mouseMove.size();
            if(cursorIdle==0 && !velocities.isEmpty()){
                int slow=0; for(double v:velocities) if(v<0.05) slow++;
                cursorIdle=(double)slow/velocities.size();
            }
        }

        List<Map<String,Object>> allMk=new ArrayList<>(mouseEv); allMk.addAll(keyEv);
        allMk.sort(Comparator.comparingDouble(e->num(e,"timestamp")));
        double alternations=0; String lastType=null;
        for(Map<String,Object> e:allMk){
            String cur=etype(e).contains("MOUSE")?"mouse":"keyboard";
            if(lastType!=null && !lastType.equals(cur)) alternations++;
            lastType=cur;
        }
        double crossCoord=allMk.isEmpty()?0.0:alternations/allMk.size();

        List<Double> holdTimes=new ArrayList<>();
        for(Map<String,Object> e:keyEv) if(hasNum(e,"hold_time")) holdTimes.add((Double)e.get("hold_time"));
        List<Double> flightTimes=new ArrayList<>();
        for(int i=1;i<keyEv.size();i++)
            flightTimes.add(num(keyEv.get(i),"timestamp")-num(keyEv.get(i-1),"timestamp"));
        double keyEntropy=0;
        if(keyEv.size()>=2){
            HashMap<String,Double> trans=new HashMap<>();
            for(int i=1;i<keyEv.size();i++){
                String k=sstr(keyEv.get(i-1),"key")+"->"+sstr(keyEv.get(i),"key");
                trans.merge(k,1.0,Double::sum);
            }
            double total=keyEv.size()-1;
            for(double cnt:trans.values()){ double p=cnt/total; keyEntropy-=p*Math.log(p+1e-9); }
        }
        double burstCount=0; boolean inBurst=false;
        for(int i=1;i<keyEv.size();i++){
            double dt=num(keyEv.get(i),"timestamp")-num(keyEv.get(i-1),"timestamp");
            if(dt<333){ if(!inBurst){ burstCount++; inBurst=true; } } else inBurst=false;
        }
        List<Double> focusTimes=new ArrayList<>();
        for(Map<String,Object> e:focusEv) focusTimes.add(num(e,"timestamp"));
        Collections.sort(focusTimes);
        List<Double> ksTimes=new ArrayList<>();
        for(Map<String,Object> e:keyEv) ksTimes.add(num(e,"timestamp"));
        Collections.sort(ksTimes);
        List<Double> crossGaps=new ArrayList<>();
        for(double ft:focusTimes){
            Double before=null; for(double t:ksTimes) if(t<ft) before=t;
            Double after=null; for(double t:ksTimes) if(t>=ft){ after=t; break; }
            if(before!=null && after!=null) crossGaps.add(after-before);
        }

        double firstTs=num(events.get(0),"timestamp");
        if(firstTs==0.0) firstTs = sessionStartTs!=0.0 ? sessionStartTs : 0.0;
        double lastTs=num(events.get(events.size()-1),"timestamp");
        if(lastTs==0.0) lastTs=firstTs;
        double duration=(lastTs-firstTs)/1000.0;
        long s=(long)Math.floor(firstTs/1000.0);
        long sod=((s%86400)+86400)%86400;
        double hour=sod/3600, minute=(sod%3600)/60;
        double timeOfDay=(hour+minute/60.0)/24.0;

        HashMap<Long,Double> perSec=new HashMap<>();
        for(Map<String,Object> e:events){ long sec=(long)Math.floor(num(e,"timestamp")/1000.0); perSec.merge(sec,1.0,Double::sum); }
        List<Double> counts=new ArrayList<>(perSec.values());
        double mAct=mean(counts), sAct=std(counts);
        double bursts=0; for(double c:counts) if(c>mAct+2*sAct) bursts++;

        List<String> pageUrls=new ArrayList<>();
        for(Map<String,Object> e:navEv){ String u=sstr(e,"page_url"); if(!u.isEmpty()) pageUrls.add(u); }
        HashSet<String> uniquePages=new HashSet<>(pageUrls);
        HashSet<String> allPages=new HashSet<>();
        for(Map<String,Object> e:events){ String u=sstr(e,"page_url"); if(!u.isEmpty()) allPages.add(u); }
        double pageTrans=pageUrls.isEmpty()?0.0:(double)uniquePages.size()/pageUrls.size();
        List<Double> scrollDeltas=new ArrayList<>();
        for(Map<String,Object> e:mouseScroll) scrollDeltas.add(Math.abs(num(e,"scroll_delta")));
        List<Double> focusSorted=new ArrayList<>();
        for(Map<String,Object> e:focusEv) focusSorted.add(num(e,"timestamp"));
        Collections.sort(focusSorted);
        List<Double> fieldGaps=new ArrayList<>();
        for(int i=1;i<focusSorted.size();i++){ double g=focusSorted.get(i)-focusSorted.get(i-1); if(g>0) fieldGaps.add(g); }
        double vmax=velocities.isEmpty()?0.0:Collections.max(velocities);

        HashMap<String,Double> out=new HashMap<>();
        out.put("mouse_velocity_mean",safe(mean(velocities)));
        out.put("mouse_velocity_std",safe(std(velocities)));
        out.put("mouse_velocity_max",safe(vmax));
        out.put("mouse_acceleration_std",safe(std(accelerations)));
        out.put("mouse_curvature_mean",safe(mean(curvatures)));
        out.put("mouse_direction_changes",safe(directionChanges));
        out.put("mouse_pause_count",safe(pauses));
        out.put("mouse_click_interval_mean",safe(mean(clickIntervals)));
        out.put("cursor_idle_ratio",safe(cursorIdle));
        out.put("cross_mouse_keyboard_coordination",safe(crossCoord));
        out.put("keystroke_dwell_time_mean",safe(mean(holdTimes)));
        out.put("keystroke_dwell_time_std",safe(std(holdTimes)));
        out.put("keystroke_flight_time_mean",safe(mean(flightTimes)));
        out.put("keystroke_transition_entropy",safe(keyEntropy));
        out.put("keystroke_typing_speed",safe(duration>0? keyEv.size()/duration : 0));
        out.put("keystroke_cross_field_cadence",safe(mean(crossGaps)));
        out.put("keystroke_burst_count",safe(burstCount));
        out.put("temporal_time_of_day_score",safe(timeOfDay));
        out.put("temporal_session_duration",safe(duration));
        out.put("temporal_activity_bursts",safe(bursts));
        out.put("nav_page_transition_pattern",safe(pageTrans));
        out.put("nav_scroll_depth_mean",safe(mean(scrollDeltas)));
        out.put("nav_page_count",safe(allPages.size()));
        out.put("nav_step_transition_count",safe(navEv.size()));
        out.put("form_focus_count",safe(focusEv.size()));
        out.put("form_blur_count",safe(blurEv.size()));
        out.put("form_field_switch_rate",safe(mean(fieldGaps)));
        int cart=0; for(Map<String,Object> e:events) if(etype(e).equals("CART_ACTION")) cart++;
        out.put("cart_action_count",safe(cart));
        keystrokeRhythm(keyEv, out);   // SPEC 1.4 (C-44)

        double[] vec=new double[F4.length];
        for(int i=0;i<F4.length;i++) vec[i]=safe(out.getOrDefault(F4[i],0.0));
        return vec;
    }

    // ============================ Kesesuaian ============================
    static boolean close(double a,double b,double tol){
        return a==b || Math.abs(a-b) <= tol*Math.max(1.0,Math.max(Math.abs(a),Math.abs(b)));
    }
    static double[][] toVecVec(Object o){
        List<Object> rows=A(o); double[][] r=new double[rows.size()][];
        for(int i=0;i<rows.size();i++){ List<Object> row=A(rows.get(i)); double[] v=new double[row.size()];
            for(int j=0;j<row.size();j++) v[j]=(Double)row.get(j); r[i]=v; }
        return r;
    }

    static int passed=0, failed=0;
    static final List<String> problems=new ArrayList<>();
    static void chk(String id,String label,double got,double want,double tol){
        if(close(got,want,tol)) passed++;
        else { failed++; problems.add(id+" / "+label+": dapat "+got+", harus "+want); }
    }
    static void chkStr(String id,String label,String got,String want){
        if(got.equals(want)) passed++;
        else { failed++; problems.add(id+" / "+label+": dapat "+got+", harus "+want); }
    }

    public static void main(String[] args) throws Exception {
        String path = args.length>0 ? args[0] : "../../core/golden.json";
        String text = Files.readString(Path.of(path));
        Map<String,Object> g = M(new JP(text).parse());
        double tol=(Double)g.get("tolerance");
        List<String> features=new ArrayList<>();
        for(Object o:A(g.get("features"))) features.add((String)o);
        int nFeatures=features.size();

        // --- SPEC v1.1: ekstraksi fitur ---
        Object fcs=g.get("feature_cases");
        if(fcs!=null) for(Object fo:A(fcs)){
            Map<String,Object> fc=M(fo);
            String id=(String)fc.get("id");
            double sst = fc.get("session_start_ts")!=null ? (Double)fc.get("session_start_ts") : 0.0;
            double[] got=extractFeatures(A(fc.get("events")), sst);
            List<Object> want=A(fc.get("expect_vector"));
            for(int i=0;i<want.size();i++)
                chk(id,"vector["+i+"] ("+features.get(i)+")",got[i],(Double)want.get(i),tol);
        }

        // --- SPEC v1.0: mesin ---
        for(Object co:A(g.get("cases"))){
            Map<String,Object> cs=M(co);
            String id=(String)cs.get("id");
            double[][] baseline=toVecVec(cs.get("baseline"));
            double[][] probes=toVecVec(cs.get("probes"));
            Map<String,Object> exp=M(cs.get("expect"));

            double[][] stats=computeStats(baseline);
            double[] mean=stats[0], std=stats[1];
            double[][] Xstd=new double[baseline.length][];
            for(int i=0;i<baseline.length;i++) Xstd[i]=standardize(baseline[i],mean,std);
            IForest iff=new IForest(Xstd);
            Mahalanobis det2=new Mahalanobis(Xstd,MAHA_SHRINK);
            Ensemble ens=new Ensemble(iff,det2,Xstd,baseline.length);
            double[] baseScores=new double[Xstd.length];
            for(int i=0;i<Xstd.length;i++) baseScores[i]=ens.scoreOne(Xstd[i]);
            double[] th=calibrateThresholdsParametric(baseScores);
            double low=th[0], med=th[1];

            Map<String,Object> et=M(exp.get("thresholds"));
            chk(id,"thresholds.low",low,(Double)et.get("low"),tol);
            chk(id,"thresholds.medium",med,(Double)et.get("medium"),tol);
            List<Object> smh=A(exp.get("stats_mean_head"));
            for(int i=0;i<smh.size();i++) chk(id,"stats.mean["+i+"]",mean[i],(Double)smh.get(i),tol);
            List<Object> ssh=A(exp.get("stats_std_head"));
            for(int i=0;i<ssh.size();i++) chk(id,"stats.std["+i+"]",std[i],(Double)ssh.get(i),tol);
            Map<String,Object> ifs=M(exp.get("if_stats"));
            chk(id,"if_stats.mean",ens.ifStats[0],(Double)ifs.get("mean"),tol);
            chk(id,"if_stats.std",ens.ifStats[1],(Double)ifs.get("std"),tol);
            Map<String,Object> svs=M(exp.get("svm_stats"));
            chk(id,"svm_stats.mean",ens.svmStats[0],(Double)svs.get("mean"),tol);
            chk(id,"svm_stats.std",ens.svmStats[1],(Double)svs.get("std"),tol);
            Map<String,Object> gw=M(exp.get("gated_weights"));
            chk(id,"gated_weights.isolation_forest",ens.gIf,(Double)gw.get("isolation_forest"),tol);
            chk(id,"gated_weights.svm",ens.gSvm,(Double)gw.get("svm"),tol);
            chk(id,"gated_weights.lstm",0.0,(Double)gw.get("lstm"),tol);

            List<Object> verdicts=A(exp.get("verdicts"));
            for(int i=0;i<probes.length;i++){
                double[] xstd=standardize(probes[i],mean,std);
                double score=ens.scoreOne(xstd);
                String level=toRisk(score,low,med);
                String action=toAction(level);
                String tf=topFeature(xstd,features);
                Map<String,Object> w=M(verdicts.get(i));
                chk(id,"probe["+i+"].score",score,(Double)w.get("score"),tol);
                chkStr(id,"probe["+i+"].level",level,(String)w.get("level"));
                chkStr(id,"probe["+i+"].action",action,(String)w.get("action"));
                chkStr(id,"probe["+i+"].topFeature",tf,(String)w.get("topFeature"));
            }
        }

        System.out.println();
        System.out.println("KESESUAIAN  spec "+g.get("spec_version")+"  toleransi "+tol);
        System.out.println("  lulus "+passed+" / "+(passed+failed));
        if(!problems.isEmpty()){
            System.out.println("  GAGAL:");
            for(int i=0;i<Math.min(25,problems.size());i++) System.out.println("    - "+problems.get(i));
        }
        System.out.println("  HASIL: "+(failed==0?"SESUAI":"TIDAK SESUAI"));
        System.exit(failed==0?0:1);
    }
}

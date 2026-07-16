import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trophy, Medal, Award, Zap, Rocket, Crown, Star, Sparkles } from "lucide-react";

interface CelebrationDeal {
  id: number;
  contactId?: number;
  contact?: Record<string, any> | null;
  totalValue?: string | number | null;
  wonAmount?: string | number | null;
  title?: string | null;
  salesOwner?: Record<string, any> | null;
}

interface Props {
  deal: CelebrationDeal;
  open: boolean;
  todayWonCount: number;
  onClose: () => void;
  onViewOrder?: () => void;
  onGoToProduction?: () => void;
}

interface Milestone {
  title: string;
  message: string;
  emoji: string;
  icon: typeof Trophy;
  gradient: string;
}

const MILESTONES: Record<number, Milestone> = {
  1: {
    title: "First Order of the Day!",
    message: "The journey begins. Let's make today a memorable one!",
    emoji: "🥇",
    icon: Medal,
    gradient: "from-amber-400 via-yellow-500 to-orange-500",
  },
  2: {
    title: "Double Header!",
    message: "Two down! Momentum is building. Keep going!",
    emoji: "🥈",
    icon: Award,
    gradient: "from-slate-300 via-gray-400 to-slate-500",
  },
  3: {
    title: "Hat-trick!",
    message: "Three orders today! Congratulations, Champ! You're on fire!",
    emoji: "🎉",
    icon: Trophy,
    gradient: "from-amber-600 via-yellow-500 to-amber-400",
  },
  4: {
    title: "Boundary Pe Boundary!",
    message: "Kya baat hai! Aaj toh sales ki baarish ho rahi hai. Keep smashing it!",
    emoji: "🏏",
    icon: Zap,
    gradient: "from-green-400 via-emerald-500 to-teal-500",
  },
  5: {
    title: "Half Century Loading...",
    message: "Form kamaal ki hai! Isi rhythm mein rahe toh aaj records tootenge.",
    emoji: "💯",
    icon: Sparkles,
    gradient: "from-blue-400 via-indigo-500 to-purple-500",
  },
  6: {
    title: "Beast Mode Activated!",
    message: "Ab toh machine ban gaye ho! Orders hi orders. Keep rocking!",
    emoji: "😎",
    icon: Rocket,
    gradient: "from-red-400 via-pink-500 to-rose-500",
  },
  7: {
    title: "Lucky Seven!",
    message: "Saat orders! Aaj toh market pe raaj hai. Dil jeet liya!",
    emoji: "🌟",
    icon: Star,
    gradient: "from-violet-400 via-purple-500 to-fuchsia-500",
  },
  8: {
    title: "Unstoppable!",
    message: "Koi nahi rok sakta! Aaj sirf jeet hi jeet.",
    emoji: "🚀",
    icon: Rocket,
    gradient: "from-cyan-400 via-blue-500 to-indigo-500",
  },
  9: {
    title: "Almost a Legend!",
    message: "Bas ek aur... Double digits are calling your name!",
    emoji: "👑",
    icon: Crown,
    gradient: "from-yellow-400 via-amber-500 to-orange-500",
  },
  10: {
    title: "Century Complete!",
    message: "10 orders in a single day! Outstanding performance. You're today's Sales Superstar!",
    emoji: "🏆",
    icon: Trophy,
    gradient: "from-emerald-400 via-green-500 to-emerald-600",
  },
};

const CONFETTI_COLORS = ["#22c55e", "#3b82f6", "#eab308", "#ec4899", "#a855f7", "#f97316", "#06b6d4", "#f43f5e", "#8b5cf6"];
const CONFETTI_COUNT = 80;

function createConfettiParticle(i: number) {
  const left = Math.random() * 100;
  const delay = Math.random() * 2;
  const duration = 2.5 + Math.random() * 2;
  const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
  const size = 6 + Math.random() * 8;
  const rotation = Math.random() * 360;
  const shape = Math.random();
  const borderRadius = shape > 0.6 ? "50%" : shape > 0.3 ? "2px" : "0";
  return { left, delay, duration, color, size, rotation, borderRadius, id: i };
}

function playCelebrationSound(milestone: number) {
  try {
    const ctx = new AudioContext();
    // Ascending notes get more triumphant with higher milestones
    const baseFreqs = milestone <= 3
      ? [523.25, 659.25, 783.99, 1046.5]
      : milestone <= 6
        ? [523.25, 659.25, 783.99, 880.0, 1046.5]
        : [523.25, 659.25, 783.99, 880.0, 1046.5, 1174.66];
    baseFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const startTime = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.18, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  } catch {
    // Audio not available
  }
}

export function DealWonCelebration({ deal, open, todayWonCount, onClose, onViewOrder, onGoToProduction }: Props) {
  const [visible, setVisible] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<"entering" | "visible" | "exiting">("entering");
  const soundPlayed = useRef(false);
  const autoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particles = useRef(Array.from({ length: CONFETTI_COUNT }, (_, i) => createConfettiParticle(i)));

  const milestone = MILESTONES[Math.min(todayWonCount, 10)] ?? MILESTONES[1];
  const MilestoneIcon = milestone.icon;

  useEffect(() => {
    if (open) {
      setVisible(true);
      setAnimationPhase("entering");
      soundPlayed.current = false;
      const enabled = localStorage.getItem("crm_dealWonCelebration") !== "off";
      if (enabled && !soundPlayed.current) {
        soundPlayed.current = true;
        playCelebrationSound(todayWonCount);
      }
      const t1 = setTimeout(() => setAnimationPhase("visible"), 400);
      // Auto-close after 5 seconds
      autoCloseRef.current = setTimeout(() => {
        setAnimationPhase("exiting");
        setTimeout(onClose, 400);
      }, 5000);
      return () => {
        clearTimeout(t1);
        if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      };
    } else {
      setAnimationPhase("exiting");
      if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleClose = useCallback(() => {
    if (autoCloseRef.current) clearTimeout(autoCloseRef.current);
    setAnimationPhase("exiting");
    setTimeout(onClose, 400);
  }, [onClose]);

  const name = deal.contact?.name || deal.title || "Customer";
  const company = deal.contact?.companyName || "";
  const salesPerson = deal.salesOwner?.name || "";
  const totalValue = deal.totalValue ? Number(deal.totalValue) : 0;
  const wonAmount = deal.wonAmount ? Number(deal.wonAmount) : 0;
  const displayValue = wonAmount > 0 ? wonAmount : totalValue;
  const formattedValue = displayValue ? `₹${displayValue.toLocaleString("en-IN")}` : "";

  if (!visible) return null;

  return (
    <>
      {/* Confetti Layer */}
      <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden" aria-hidden="true">
        {particles.current.map((p) => (
          <div
            key={p.id}
            className="absolute"
            style={{
              left: `${p.left}%`,
              top: "-10px",
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              borderRadius: p.borderRadius,
              opacity: 0,
              transform: `rotate(${p.rotation}deg)`,
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
            }}
          />
        ))}
      </div>

      {/* Celebration Modal */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent
          className={`sm:max-w-lg border-0 shadow-2xl [&>button]:hidden transition-all duration-500 ease-out overflow-hidden ${
            animationPhase === "entering" ? "scale-75 opacity-0" :
            animationPhase === "visible" ? "scale-100 opacity-100" :
            "scale-75 opacity-0"
          }`}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{milestone.title}</DialogTitle>
          <DialogDescription className="sr-only">{milestone.message}</DialogDescription>
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }
            @keyframes shimmer {
              0% { background-position: -200% center; }
              100% { background-position: 200% center; }
            }
            @keyframes pulse-glow {
              0%, 100% { box-shadow: 0 0 20px rgba(255,215,0,0.3); }
              50% { box-shadow: 0 0 40px rgba(255,215,0,0.6); }
            }
          `}</style>

          <div className="flex flex-col items-center py-6 px-4 text-center space-y-5">
            {/* Gradient Header Banner */}
            <div className={`w-full bg-gradient-to-r ${milestone.gradient} rounded-xl p-5 text-white relative overflow-hidden`}>
              <div className="absolute inset-0 bg-white/10" style={{
                background: "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)",
              }} />
              <div className="relative flex items-center justify-center gap-3">
                <span className="text-4xl">{milestone.emoji}</span>
                <div className="text-left">
                  <p className="text-xs uppercase tracking-widest opacity-80 font-medium">Milestone #{todayWonCount}</p>
                  <h2 className="text-xl font-bold tracking-tight leading-tight">{milestone.title}</h2>
                </div>
              </div>
            </div>

            {/* Trophy / Icon */}
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-700 ${
                animationPhase === "visible" ? "scale-100" : "scale-0"
              }`}
              style={{
                background: "linear-gradient(135deg, #fbbf24, #f59e0b, #d97706)",
                animation: animationPhase === "visible" ? "pulse-glow 2s ease-in-out infinite" : "none",
              }}
            >
              <MilestoneIcon className="w-10 h-10 text-white" strokeWidth={2} />
            </div>

            {/* Message */}
            <div className="space-y-1">
              <p className="text-base text-muted-foreground font-medium leading-relaxed max-w-sm">
                {milestone.message}
              </p>
            </div>

            {/* Deal Info Cards */}
            <div className="w-full space-y-2">
              <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-lg p-3 flex items-center justify-between">
                <span className="text-sm text-emerald-700 font-medium">Customer</span>
                <span className="text-sm font-bold text-emerald-900">{name}</span>
              </div>
              {company && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-500 font-medium">Company</span>
                  <span className="text-sm font-bold text-gray-900">{company}</span>
                </div>
              )}
              {formattedValue && (
                <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-sm text-amber-700 font-medium">Won Value</span>
                  <span className="text-sm font-bold text-amber-900">{formattedValue}</span>
                </div>
              )}
              {salesPerson && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
                  <span className="text-sm text-gray-500 font-medium">Sales Person</span>
                  <span className="text-sm font-bold text-gray-900">{salesPerson}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col w-full gap-2 pt-1">
              <div className="flex gap-2 w-full">
                {onViewOrder && (
                  <Button className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-semibold" onClick={onViewOrder}>
                    View Order
                  </Button>
                )}
                {onGoToProduction && (
                  <Button className="flex-1" variant="outline" onClick={onGoToProduction}>
                    Go to Production
                  </Button>
                )}
              </div>
              <Button variant="ghost" onClick={handleClose} className="text-muted-foreground text-sm">
                Continue
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

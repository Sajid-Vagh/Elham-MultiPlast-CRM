import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle2 } from "lucide-react";

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
  onClose: () => void;
  onViewOrder?: () => void;
  onGoToProduction?: () => void;
}

const CONFETTI_COLORS = ["#22c55e", "#3b82f6", "#eab308", "#ec4899", "#a855f7", "#f97316", "#06b6d4"];
const CONFETTI_COUNT = 60;

function createConfettiParticle(i: number) {
  const left = Math.random() * 100;
  const delay = Math.random() * 2;
  const duration = 2.5 + Math.random() * 1.5;
  const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
  const size = 6 + Math.random() * 6;
  const rotation = Math.random() * 360;
  return { left, delay, duration, color, size, rotation, id: i };
}

function playCelebrationSound() {
  try {
    const ctx = new AudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const startTime = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
      osc.start(startTime);
      osc.stop(startTime + 0.5);
    });
  } catch {
    // Audio not available
  }
}

export function DealWonCelebration({ deal, open, onClose, onViewOrder, onGoToProduction }: Props) {
  const [visible, setVisible] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<"entering" | "visible" | "exiting">("entering");
  const soundPlayed = useRef(false);
  const particles = useRef(Array.from({ length: CONFETTI_COUNT }, (_, i) => createConfettiParticle(i)));

  useEffect(() => {
    if (open) {
      setVisible(true);
      setAnimationPhase("entering");
      const enabled = localStorage.getItem("crm_dealWonCelebration") !== "off";
      if (enabled && !soundPlayed.current) {
        soundPlayed.current = true;
        playCelebrationSound();
      }
      const t1 = setTimeout(() => setAnimationPhase("visible"), 400);
      return () => { clearTimeout(t1); };
    } else {
      setAnimationPhase("exiting");
      const t = setTimeout(() => setVisible(false), 400);
      return () => clearTimeout(t);
    }
  }, [open]);

  const handleClose = useCallback(() => {
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
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

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
              borderRadius: Math.random() > 0.5 ? "50%" : "2px",
              opacity: 0,
              transform: `rotate(${p.rotation}deg)`,
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
            }}
          />
        ))}
      </div>

      {/* Success Modal */}
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
        <DialogContent
          className={`sm:max-w-md border-0 shadow-2xl [&>button]:hidden transition-all duration-500 ease-out ${
            animationPhase === "entering" ? "scale-75 opacity-0" : 
            animationPhase === "visible" ? "scale-100 opacity-100" : 
            "scale-75 opacity-0"
          }`}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">Deal Won Successfully</DialogTitle>
          <DialogDescription className="sr-only">Congratulations! The deal has been marked as won.</DialogDescription>
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(0) rotate(0deg); opacity: 1; }
              100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }
          `}</style>

          <div className="flex flex-col items-center py-6 px-2 text-center space-y-4">
            {/* Success Checkmark */}
            <div className="relative">
              <div className={`w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center transition-all duration-500 ${
                animationPhase === "visible" ? "scale-100" : "scale-0"
              }`}>
                <CheckCircle2 className="w-12 h-12 text-emerald-600" strokeWidth={1.5} />
              </div>
            </div>

            {/* Title */}
            <div>
              <h2 className="text-2xl font-bold tracking-tight">🎉 Congratulations!</h2>
              <p className="text-muted-foreground mt-1 text-lg font-medium">Deal Successfully Won</p>
            </div>

            {/* Customer Info */}
            <div className="w-full bg-muted/50 rounded-lg p-4 space-y-2 text-left">
              <p className="text-sm">
                <span className="text-muted-foreground">Customer</span>
                <br />
                <span className="font-semibold">{name}</span>
              </p>
              {company && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Company</span>
                  <br />
                  <span className="font-semibold">{company}</span>
                </p>
              )}
              {formattedValue && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Deal Value</span>
                  <br />
                  <span className="font-semibold text-emerald-700">{formattedValue}</span>
                </p>
              )}
              {salesPerson && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Sales Person</span>
                  <br />
                  <span className="font-semibold">{salesPerson}</span>
                </p>
              )}
              <p className="text-sm">
                <span className="text-muted-foreground">Date & Time</span>
                <br />
                <span className="font-semibold">{dateStr} at {timeStr}</span>
              </p>
            </div>

            {/* Encouragement */}
            <p className="text-sm text-muted-foreground italic">
              Congratulations {name}! Keep up the great work!
            </p>

            {/* Actions */}
            <div className="flex flex-col w-full gap-2 pt-2">
              <div className="flex gap-2 w-full">
                {onViewOrder && (
                  <Button className="flex-1" onClick={onViewOrder}>
                    View Order
                  </Button>
                )}
                {onGoToProduction && (
                  <Button className="flex-1" variant="outline" onClick={onGoToProduction}>
                    Go to Production
                  </Button>
                )}
              </div>
              <Button variant="ghost" onClick={handleClose} className="text-muted-foreground">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

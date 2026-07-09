// ──────────────────────────────────────────────
// Noodle: fake social media timeline
// ──────────────────────────────────────────────
import {
  AtSign,
  Bell,
  ChevronLeft,
  ChevronRight,
  Dices,
  FolderOpen,
  Heart,
  Home,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Settings2,
  Smile,
  Trash2,
  X,
  User,
  UserMinus,
  UserPlus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type {
  APIConnection,
  NoodleAccount,
  NoodleCarryoverTarget,
  NoodleInteraction,
  NoodleInteractionType,
  NoodlePost,
  NoodleSettingsUpdateInput,
} from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { useActivePersona, useCharacterGroups, useCharacters, usePersonas } from "../../hooks/use-characters";
import { useConnections } from "../../hooks/use-connections";
import { useUploadGlobalGalleryImages } from "../../hooks/use-global-gallery";
import { HelpTooltip } from "../ui/HelpTooltip";
import {
  ConversationMediaPickerPanel,
  type ConversationMediaPickerTab,
  type ConversationMediaPickerTabId,
} from "../chat/ConversationMediaPickerPanel";
import { Modal } from "../ui/Modal";
import {
  useCreateNoodleInteraction,
  useCreateNoodlePost,
  useDeleteNoodlePost,
  useInviteNoodleCharacter,
  useInviteNoodleCharacters,
  useNoodle,
  useRefreshNoodle,
  useRemoveNoodleCharacter,
  useRemoveNoodleInteraction,
  useResetNoodleTimeline,
  useUpdateNoodleAccount,
  useUpdateNoodlePost,
  useUpdateNoodleSettings,
} from "../../hooks/use-noodle";

type RawCharacter = { id?: unknown; data?: unknown; avatarPath?: unknown };
type RawCharacterGroup = { id?: unknown; name?: unknown; description?: unknown; characterIds?: unknown };
type RawPersona = { id?: unknown; createdAt?: unknown; updatedAt?: unknown };

const fieldClass =
  "mari-chrome-field h-9 w-full min-w-0 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 text-xs text-[var(--foreground)] outline-none transition-colors focus:border-[var(--noodle-blue)]";
const textareaClass =
  "mari-chrome-field min-h-24 w-full min-w-0 resize-y rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] p-3 text-xs leading-relaxed text-[var(--foreground)] outline-none transition-colors focus:border-[var(--noodle-blue)]";
const labelClass =
  "text-[0.68rem] font-semibold uppercase tracking-normal text-[var(--marinara-chat-chrome-panel-muted)]";
const iconButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium !text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:!text-[var(--noodle-blue)]";
const NOODLE_BLUE = "#7EA7FF";
const NOODLE_LOGO_SRC = "/noodle-klusek.png";
const NOODLE_INVITE_PAGE_SIZE = 50;
const NOODLE_PERSONA_SWITCHER_PAGE_SIZE = 5;
const NOODLE_CARRYOVER_TARGETS: NoodleCarryoverTarget[] = ["conversation", "roleplay", "game"];
const NOODLE_MEDIA_PICKER_TABS: ConversationMediaPickerTab[] = [
  { id: "emoji", label: "Emoji" },
  { id: "gifs", label: "GIFs" },
  { id: "stickers", label: "Stickers" },
];

type ComposerTool = "image" | "poll" | "media";
type ProfileTab = "posts" | "likes" | "media";
type ProfileConnectionTab = "followers" | "following";
type NotificationTab = "likes" | "follows" | "replies";
type TimelineTab = "main" | "following";
type NoodleViewId = "home" | "notifications" | "profile" | "settings";
type NoodleConfirmAction =
  | {
      kind: "delete-post";
      postId: string;
      title: string;
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "reset-timeline";
      title: string;
      message: string;
      confirmLabel: string;
    };

const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "likes", label: "Likes" },
  { id: "media", label: "Media" },
];

const TIMELINE_TABS: Array<{ id: TimelineTab; label: string }> = [
  { id: "main", label: "Main" },
  { id: "following", label: "Following" },
];

const PROFILE_CONNECTION_TABS: Array<{ id: ProfileConnectionTab; label: string }> = [
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
];

const NOTIFICATION_TABS: Array<{ id: NotificationTab; label: string }> = [
  { id: "likes", label: "Likes" },
  { id: "follows", label: "Follows" },
  { id: "replies", label: "Replies" },
];

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function carryoverTargetsFromLegacy(mode: string | undefined): NoodleCarryoverTarget[] {
  if (mode === "all") return [...NOODLE_CARRYOVER_TARGETS];
  if (mode === "conversation" || mode === "roleplay" || mode === "game") return [mode];
  return [];
}

function legacyCarryoverModeFromTargets(targets: NoodleCarryoverTarget[]): NoodleSettingsUpdateInput["carryoverMode"] {
  const selected = new Set(targets);
  if (NOODLE_CARRYOVER_TARGETS.every((target) => selected.has(target))) return "all";
  if (targets.length === 1) return targets[0]!;
  return "off";
}

function readAccountSetting(account: NoodleAccount | null, key: string) {
  return readString(account?.settings?.[key]).trim();
}

function readAccountSettingBoolean(account: NoodleAccount | null, key: string) {
  const value = account?.settings?.[key];
  return value === true || value === "true";
}

function hasGeneratedProfile(account: NoodleAccount | null) {
  return readAccountSettingBoolean(account, "profileGenerated");
}

function sortAccountsByDisplayName(left: NoodleAccount, right: NoodleAccount) {
  return left.displayName.localeCompare(right.displayName) || left.handle.localeCompare(right.handle);
}

function accountTimestamp(account: NoodleAccount) {
  return Date.parse(account.updatedAt || account.createdAt) || 0;
}

function uniqueAccountsById(accounts: Array<NoodleAccount | null | undefined>) {
  const seen = new Set<string>();
  const result: NoodleAccount[] = [];
  for (const account of accounts) {
    if (!account || seen.has(account.id)) continue;
    seen.add(account.id);
    result.push(account);
  }
  return result;
}

function extractAccountSearchTerm(query: string) {
  const match = query.match(/@([a-zA-Z0-9_.-]*)/);
  return match ? match[1]!.toLowerCase() : "";
}

function accountMatchesSearch(account: NoodleAccount, term: string) {
  if (!term) return true;
  return [account.handle, account.displayName, account.bio].some((value) => value.toLowerCase().includes(term));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textMentionsHandle(text: string | null | undefined, handle: string) {
  const normalizedHandle = handle.trim().replace(/^@+/, "");
  if (!text || !normalizedHandle) return false;
  return new RegExp(`(^|\\s)@${escapeRegExp(normalizedHandle)}(?![\\w.-])`, "i").test(text);
}

function characterName(character: RawCharacter) {
  const data = parseRecord(character.data);
  return readString(data.name).trim() || "Character";
}

function characterGroupName(group: RawCharacterGroup) {
  return readString(group.name).trim() || "Character folder";
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "N"
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function Avatar({
  account,
  size = "md",
}: {
  account: Pick<NoodleAccount, "displayName" | "avatarUrl">;
  size?: "sm" | "md" | "lg";
}) {
  const dimension = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-24 w-24" : "h-11 w-11";
  if (account.avatarUrl) {
    return (
      <img
        src={account.avatarUrl}
        alt=""
        className={cn(dimension, "shrink-0 rounded-full border border-[var(--noodle-blue)]/30 object-cover")}
      />
    );
  }
  return (
    <div
      className={cn(
        dimension,
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--noodle-blue)]/15 text-xs font-bold text-[var(--noodle-blue)] ring-1 ring-[var(--noodle-blue)]/25",
      )}
    >
      {initials(account.displayName)}
    </div>
  );
}

function NoodleLogo({ className }: { className?: string }) {
  return <img src={NOODLE_LOGO_SRC} alt="" className={cn("object-contain", className)} />;
}

function FieldLabel({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return (
    <span className={cn(labelClass, "inline-flex items-center gap-1")}>
      {children}
      {help && <HelpTooltip text={help} side="top" wide />}
    </span>
  );
}

function Section({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--noodle-divider)] p-4 last:border-b-0">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
        <Settings2 size={13} className="text-[var(--noodle-blue)]" />
        {title}
        {help && <HelpTooltip text={help} side="bottom" wide />}
      </h3>
      {children}
    </section>
  );
}

function ToggleSetting({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-xs">
      <span className="inline-flex min-w-0 items-center gap-1 font-semibold">
        {label}
        {help && <HelpTooltip text={help} side="top" wide />}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function BrowserChrome() {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--noodle-divider)] bg-[var(--background)] px-2.5 sm:px-3">
      <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--noodle-blue)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted-foreground)]/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted-foreground)]/25" />
      </div>
      <div className="hidden items-center gap-0.5 sm:flex" aria-hidden="true">
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] opacity-70">
          <ChevronLeft size={15} />
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)] opacity-50">
          <ChevronRight size={15} />
        </span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--noodle-blue)]">
          <RefreshCw size={14} />
        </span>
      </div>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--card)] px-3 text-xs shadow-sm">
        <Lock size={13} className="hidden shrink-0 text-[var(--noodle-blue)] sm:block" />
        <Search size={14} className="shrink-0 text-[var(--noodle-blue)] sm:hidden" />
        <span className="truncate text-[var(--foreground)] sm:hidden">noodle.marinara.local/home</span>
        <span className="hidden truncate text-[var(--foreground)] sm:inline">https://noodle.local</span>
        <span className="hidden rounded-full bg-[var(--noodle-blue)]/15 px-2 py-0.5 font-semibold text-[var(--noodle-blue)] sm:inline-flex">
          Noodle
        </span>
      </div>
    </div>
  );
}

function countInteractions(interactions: NoodleInteraction[], type: NoodleInteractionType) {
  return interactions.filter((interaction) => interaction.type === type).length;
}

function NoodleToolButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 !text-[var(--noodle-blue)] transition-colors active:scale-95 [&_svg]:!text-[var(--noodle-blue)]",
        active ? "bg-[var(--noodle-blue)]/15 ring-1 ring-[var(--noodle-blue)]/25" : "hover:bg-[var(--noodle-blue)]/10",
      )}
    >
      {children}
    </button>
  );
}

function NoodleAnchoredPopover({
  anchorRef,
  children,
  wide,
  className,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelWidth = panelRef.current?.offsetWidth ?? (wide ? 384 : 304);
      const padding = 16;
      const maxLeft = Math.max(padding, window.innerWidth - panelWidth - padding);
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - panelWidth / 2;
      setPosition({
        left: Math.min(Math.max(centeredLeft, padding), maxLeft),
        top: anchorRect.bottom + 12,
      });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, wide]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn("fixed z-[80] max-w-[calc(100vw-2rem)]", wide ? "w-[18rem] sm:w-[24rem]" : "w-[19rem]", className)}
      style={
        {
          "--noodle-blue": NOODLE_BLUE,
          "--noodle-divider": "var(--marinara-chat-chrome-panel-divider)",
          left: position?.left ?? -9999,
          top: position?.top ?? -9999,
          opacity: position ? 1 : 0,
        } as CSSProperties
      }
    >
      {children}
    </div>,
    document.body,
  );
}

function NoodleToolPopover({
  title,
  onClose,
  children,
  wide,
  anchorRef,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <NoodleAnchoredPopover anchorRef={anchorRef} wide={wide}>
      <div className="marinara-chat-popover flex h-[22rem] max-h-[60vh] flex-col overflow-hidden rounded-xl border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl shadow-black/35">
        <div className="flex shrink-0 items-center gap-1 border-b border-foreground/10 px-2 py-1.5">
          <span className="flex-1 rounded-md bg-foreground/10 px-2 py-1 text-center text-xs font-medium text-foreground/80 ring-1 ring-foreground/15">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--noodle-blue)] transition-colors hover:bg-foreground/10"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </NoodleAnchoredPopover>
  );
}

export function NoodleView() {
  const { data, isLoading } = useNoodle();
  const { data: activePersona } = useActivePersona();
  const { data: personasRaw } = usePersonas();
  const { data: charactersRaw } = useCharacters();
  const { data: characterGroupsRaw } = useCharacterGroups();
  const { data: connectionsRaw } = useConnections();
  const updateSettings = useUpdateNoodleSettings();
  const updateAccount = useUpdateNoodleAccount();
  const inviteCharacter = useInviteNoodleCharacter();
  const inviteCharacters = useInviteNoodleCharacters();
  const removeCharacter = useRemoveNoodleCharacter();
  const createPost = useCreateNoodlePost();
  const updatePost = useUpdateNoodlePost();
  const deletePost = useDeleteNoodlePost();
  const createInteraction = useCreateNoodleInteraction();
  const removeInteraction = useRemoveNoodleInteraction();
  const refreshNoodle = useRefreshNoodle();
  const resetNoodleTimeline = useResetNoodleTimeline();
  const uploadGlobalImages = useUploadGlobalGalleryImages();
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);
  const bannerFileRef = useRef<HTMLInputElement | null>(null);
  const imageToolRef = useRef<HTMLDivElement | null>(null);
  const pollToolRef = useRef<HTMLDivElement | null>(null);
  const mediaToolRef = useRef<HTMLDivElement | null>(null);
  const modalImageToolRef = useRef<HTMLDivElement | null>(null);
  const modalPollToolRef = useRef<HTMLDivElement | null>(null);
  const modalMediaToolRef = useRef<HTMLDivElement | null>(null);
  const accountSwitcherRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollRef = useRef<HTMLElement | null>(null);

  const characters = useMemo(
    () => (Array.isArray(charactersRaw) ? (charactersRaw as RawCharacter[]) : []),
    [charactersRaw],
  );
  const personas = useMemo(() => (Array.isArray(personasRaw) ? (personasRaw as RawPersona[]) : null), [personasRaw]);
  const characterGroups = useMemo(
    () => (Array.isArray(characterGroupsRaw) ? (characterGroupsRaw as RawCharacterGroup[]) : []),
    [characterGroupsRaw],
  );
  const allConnections = useMemo(
    () => (Array.isArray(connectionsRaw) ? (connectionsRaw as Partial<APIConnection>[]) : []),
    [connectionsRaw],
  );
  const connections = useMemo(
    () =>
      allConnections.filter(
        (connection) => connection.provider !== "image_generation" && connection.provider !== "video_generation",
      ),
    [allConnections],
  );
  const imageConnections = useMemo(
    () => allConnections.filter((connection) => connection.provider === "image_generation"),
    [allConnections],
  );

  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [composer, setComposer] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [profileHandle, setProfileHandle] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileBannerUrl, setProfileBannerUrl] = useState("");
  const [profileLocation, setProfileLocation] = useState("");
  const [profileUploadTarget, setProfileUploadTarget] = useState<"avatar" | "banner" | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileTab, setProfileTab] = useState<ProfileTab>("posts");
  const [profileConnectionTab, setProfileConnectionTab] = useState<ProfileConnectionTab | null>(null);
  const [notificationTab, setNotificationTab] = useState<NotificationTab>("likes");
  const [activeNoodleView, setActiveNoodleView] = useState<NoodleViewId>("home");
  const [viewedProfileAccountId, setViewedProfileAccountId] = useState<string | null>(null);
  const [timelineTab, setTimelineTab] = useState<TimelineTab>("main");
  const [inviteSearch, setInviteSearch] = useState("");
  const [inviteFoldersOpen, setInviteFoldersOpen] = useState(false);
  const [inviteCharacterLimit, setInviteCharacterLimit] = useState(NOODLE_INVITE_PAGE_SIZE);
  const [replyPostId, setReplyPostId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [postMenuId, setPostMenuId] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostContent, setEditingPostContent] = useState("");
  const [confirmAction, setConfirmAction] = useState<NoodleConfirmAction | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [personaAccountLimit, setPersonaAccountLimit] = useState(NOODLE_PERSONA_SWITCHER_PAGE_SIZE);
  const [activeComposerTool, setActiveComposerTool] = useState<ComposerTool | null>(null);
  const [mediaPickerTab, setMediaPickerTab] = useState<ConversationMediaPickerTabId>("emoji");
  const [attachedImageUrl, setAttachedImageUrl] = useState("");
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [imageGenerationPromptDraft, setImageGenerationPromptDraft] = useState("");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState(["", ""]);

  const accounts = useMemo(() => data?.accounts ?? [], [data?.accounts]);
  const livePersonaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const persona of personas ?? []) {
      const id = readString(persona.id);
      if (id) ids.add(id);
    }
    return ids;
  }, [personas]);
  const personaRecencyById = useMemo(() => {
    const recency = new Map<string, number>();
    for (const persona of personas ?? []) {
      const id = readString(persona.id);
      if (!id) continue;
      recency.set(id, Date.parse(readString(persona.updatedAt) || readString(persona.createdAt)) || 0);
    }
    return recency;
  }, [personas]);
  const personaAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.kind === "persona" && (personas === null || livePersonaIds.has(account.entityId)),
      ),
    [accounts, livePersonaIds, personas],
  );
  const sortedPersonaAccounts = useMemo(
    () =>
      personaAccounts.slice().sort((left, right) => {
        const leftRecency = personaRecencyById.get(left.entityId) ?? accountTimestamp(left);
        const rightRecency = personaRecencyById.get(right.entityId) ?? accountTimestamp(right);
        return rightRecency - leftRecency || sortAccountsByDisplayName(left, right);
      }),
    [personaAccounts, personaRecencyById],
  );
  const visiblePersonaAccounts = useMemo(
    () => sortedPersonaAccounts.slice(0, personaAccountLimit),
    [personaAccountLimit, sortedPersonaAccounts],
  );
  const hasMorePersonaAccounts = visiblePersonaAccounts.length < sortedPersonaAccounts.length;
  const posts = useMemo(() => data?.posts ?? [], [data?.posts]);
  const interactions = useMemo(() => data?.interactions ?? [], [data?.interactions]);
  const settings = data?.settings;
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const postById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const characterAccountByEntity = useMemo(
    () =>
      new Map(accounts.filter((account) => account.kind === "character").map((account) => [account.entityId, account])),
    [accounts],
  );
  const personaAccount = useMemo(
    () => personaAccounts.find((account) => account.entityId === selectedPersonaId) ?? sortedPersonaAccounts[0] ?? null,
    [personaAccounts, selectedPersonaId, sortedPersonaAccounts],
  );
  const viewedProfileAccount = useMemo(
    () => (viewedProfileAccountId ? (accountById.get(viewedProfileAccountId) ?? personaAccount) : personaAccount),
    [accountById, personaAccount, viewedProfileAccountId],
  );
  const viewingOwnProfile = Boolean(personaAccount && viewedProfileAccount?.id === personaAccount.id);

  useEffect(() => {
    if (selectedPersonaId && personaAccounts.some((account) => account.entityId === selectedPersonaId)) return;
    const activeId = readString((activePersona as RawPersona | null)?.id);
    const activeAccount = personaAccounts.find((account) => account.entityId === activeId);
    const nextPersonaId = activeAccount?.entityId ?? sortedPersonaAccounts[0]?.entityId ?? "";
    if (selectedPersonaId !== nextPersonaId) setSelectedPersonaId(nextPersonaId);
  }, [activePersona, personaAccounts, selectedPersonaId, sortedPersonaAccounts]);

  useEffect(() => {
    if (accountSwitcherOpen) setPersonaAccountLimit(NOODLE_PERSONA_SWITCHER_PAGE_SIZE);
  }, [accountSwitcherOpen]);

  useEffect(() => {
    setImageGenerationPromptDraft(settings?.imageGenerationPrompt ?? "");
  }, [settings?.imageGenerationPrompt]);

  useEffect(() => {
    if (!personaAccount) return;
    setProfileHandle(personaAccount.handle);
    setProfileName(personaAccount.displayName);
    setProfileBio(personaAccount.bio);
    setProfileAvatarUrl(personaAccount.avatarUrl ?? "");
    setProfileBannerUrl(readAccountSetting(personaAccount, "bannerUrl"));
    setProfileLocation(readAccountSetting(personaAccount, "location"));
    setProfileEditing(false);
  }, [personaAccount]);

  useEffect(() => {
    setInviteCharacterLimit(NOODLE_INVITE_PAGE_SIZE);
  }, [inviteSearch]);

  const saveSettings = (patch: NoodleSettingsUpdateInput) => {
    updateSettings.mutate(patch, {
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle settings."),
    });
  };

  const saveProfile = () => {
    if (!personaAccount) return;
    const normalizedHandle = profileHandle.trim().replace(/^@+/, "");
    const nextSettings = {
      ...personaAccount.settings,
      bannerUrl: profileBannerUrl.trim(),
      location: profileLocation.trim(),
    };
    updateAccount.mutate(
      {
        id: personaAccount.id,
        handle: normalizedHandle,
        displayName: profileName.trim(),
        bio: profileBio,
        avatarUrl: profileAvatarUrl.trim() || null,
        settings: nextSettings,
      },
      {
        onSuccess: () => {
          setProfileEditing(false);
          toast.success("Noodle profile updated.");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle profile."),
      },
    );
  };

  const handleProfileImageFile = (target: "avatar" | "banner", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfileUploadTarget(target);
    uploadGlobalImages.mutate(
      { files: [file] },
      {
        onSuccess: (images) => {
          const image = images[0];
          if (!image?.url) {
            toast.error("Image uploaded, but no URL was returned.");
            return;
          }
          if (target === "avatar") setProfileAvatarUrl(image.url);
          else setProfileBannerUrl(image.url);

          if (!personaAccount) return;
          updateAccount.mutate(
            target === "avatar"
              ? { id: personaAccount.id, avatarUrl: image.url }
              : {
                  id: personaAccount.id,
                  settings: {
                    ...personaAccount.settings,
                    bannerUrl: image.url,
                  },
                },
            {
              onSuccess: () => toast.success(target === "avatar" ? "Noodle avatar updated." : "Noodle banner updated."),
              onError: (error) =>
                toast.error(error instanceof Error ? error.message : "Could not update Noodle profile image."),
            },
          );
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not upload profile image."),
        onSettled: () => setProfileUploadTarget(null),
      },
    );
  };

  const appendToComposer = (text: string) => {
    setComposer((current) => {
      const trimmed = current.trimEnd();
      if (!trimmed) return text;
      return `${trimmed}${trimmed.endsWith("\n") ? "" : " "}${text}`;
    });
  };

  const applyImageUrl = () => {
    const url = imageUrlDraft.trim();
    if (!url) {
      toast.error("Paste an image URL first.");
      return;
    }
    setAttachedImageUrl(url);
    setImageUrlDraft("");
    setActiveComposerTool(null);
  };

  const handleImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadGlobalImages.mutate(
      { files: [file] },
      {
        onSuccess: (images) => {
          const image = images[0];
          if (!image?.url) {
            toast.error("Image uploaded, but no URL was returned.");
            return;
          }
          setAttachedImageUrl(image.url);
          setActiveComposerTool(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not attach image."),
      },
    );
  };

  const applyPoll = () => {
    const question = pollQuestion.trim();
    const options = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      toast.error("Polls need a question and at least two options.");
      return;
    }
    const block = [`Poll: ${question}`, ...options.map((option, index) => `${index + 1}. ${option}`)].join("\n");
    setComposer((current) => (current.trim() ? `${current.trim()}\n\n${block}` : block));
    setPollQuestion("");
    setPollOptions(["", ""]);
    setActiveComposerTool(null);
  };

  const canSubmitPost = Boolean(personaAccount && (composer.trim() || attachedImageUrl.trim()));
  const confirmActionPending =
    confirmAction?.kind === "delete-post"
      ? deletePost.isPending
      : confirmAction?.kind === "reset-timeline"
        ? resetNoodleTimeline.isPending
        : false;
  const normalizedProfileHandle = profileHandle.trim().replace(/^@+/, "");
  const isEditingOwnProfile = viewingOwnProfile && profileEditing;
  const profileDisplayName = viewingOwnProfile
    ? profileName.trim() || viewedProfileAccount?.displayName || "Noodle Account"
    : viewedProfileAccount?.displayName || "Noodle Account";
  const profileDisplayHandle = viewingOwnProfile ? normalizedProfileHandle : (viewedProfileAccount?.handle ?? "noodle");
  const profileBioPreview = viewingOwnProfile ? profileBio.trim() : (viewedProfileAccount?.bio.trim() ?? "");
  const profileAvatarPreview = viewingOwnProfile
    ? profileAvatarUrl.trim() || null
    : (viewedProfileAccount?.avatarUrl ?? null);
  const profilePreviewAccount = {
    displayName: profileDisplayName,
    avatarUrl: profileAvatarPreview,
  };
  const profileBannerPreview = viewingOwnProfile
    ? profileBannerUrl.trim()
    : readAccountSetting(viewedProfileAccount, "bannerUrl");
  const profileLocationPreview = viewingOwnProfile
    ? profileLocation.trim()
    : readAccountSetting(viewedProfileAccount, "location");
  const canSaveProfile = Boolean(viewingOwnProfile && profileName.trim() && normalizedProfileHandle);
  const rawPostSearch = postSearch.trim();
  const normalizedPostSearch = rawPostSearch.toLowerCase();
  const isAccountSearch = rawPostSearch.includes("@");
  const accountSearchTerm = extractAccountSearchTerm(rawPostSearch);
  const selectedCharacterGroupIds = useMemo(
    () => new Set(settings?.invitedCharacterGroupIds ?? []),
    [settings?.invitedCharacterGroupIds],
  );
  const folderInvitedCharacterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of characterGroups) {
      const groupId = readString(group.id);
      if (!groupId || !selectedCharacterGroupIds.has(groupId)) continue;
      for (const characterId of readStringArray(group.characterIds)) ids.add(characterId);
    }
    return ids;
  }, [characterGroups, selectedCharacterGroupIds]);
  const selectedFolderCharacterIds = useMemo(() => Array.from(folderInvitedCharacterIds), [folderInvitedCharacterIds]);
  const uninvitedSelectedFolderCharacterIds = useMemo(
    () => selectedFolderCharacterIds.filter((id) => characterAccountByEntity.get(id)?.invited !== true),
    [characterAccountByEntity, selectedFolderCharacterIds],
  );
  const folderInviteButtonLabel =
    selectedCharacterGroupIds.size === 0
      ? "Select folders to invite"
      : uninvitedSelectedFolderCharacterIds.length === 0
        ? "Selected folder characters are invited"
        : `Invite ${uninvitedSelectedFolderCharacterIds.length} ${
            uninvitedSelectedFolderCharacterIds.length === 1 ? "character" : "characters"
          }`;
  const followedAccountIds = useMemo(
    () => new Set(readStringArray(personaAccount?.settings?.followingAccountIds)),
    [personaAccount?.settings],
  );
  const canFollowViewedProfile = Boolean(
    viewedProfileAccount &&
    viewedProfileAccount.kind === "character" &&
    hasGeneratedProfile(viewedProfileAccount) &&
    (viewedProfileAccount.invited || folderInvitedCharacterIds.has(viewedProfileAccount.entityId)),
  );
  const canFollowAccount = useCallback(
    (account: NoodleAccount | null) =>
      Boolean(
        account &&
        account.kind === "character" &&
        hasGeneratedProfile(account) &&
        (account.invited || folderInvitedCharacterIds.has(account.entityId)),
      ),
    [folderInvitedCharacterIds],
  );
  const viewedProfileFollowed = Boolean(viewedProfileAccount && followedAccountIds.has(viewedProfileAccount.id));
  const followedCharacterAccountIds = useMemo(
    () =>
      new Set(
        accounts
          .filter(
            (account) =>
              account.kind === "character" &&
              followedAccountIds.has(account.id) &&
              (account.invited || folderInvitedCharacterIds.has(account.entityId)),
          )
          .map((account) => account.id),
      ),
    [accounts, folderInvitedCharacterIds, followedAccountIds],
  );
  const baseTimelinePosts = useMemo(
    () =>
      timelineTab === "following"
        ? posts.filter((post) => followedCharacterAccountIds.has(post.authorAccountId))
        : posts,
    [followedCharacterAccountIds, posts, timelineTab],
  );
  const timelinePosts = useMemo(() => {
    if (!normalizedPostSearch || isAccountSearch) return baseTimelinePosts;
    return baseTimelinePosts.filter((post) => {
      const author = accountById.get(post.authorAccountId) ?? post.authorSnapshot;
      return [post.content, post.imagePrompt, author?.displayName, author?.handle].some((value) =>
        readString(value).toLowerCase().includes(normalizedPostSearch),
      );
    });
  }, [accountById, baseTimelinePosts, isAccountSearch, normalizedPostSearch]);
  const accountSearchResults = useMemo(() => {
    if (!isAccountSearch) return [];
    const exactHandle = accountSearchTerm;
    return accounts
      .filter((account) => accountMatchesSearch(account, exactHandle))
      .sort((left, right) => {
        const leftExact = left.handle.toLowerCase() === exactHandle;
        const rightExact = right.handle.toLowerCase() === exactHandle;
        if (leftExact !== rightExact) return leftExact ? -1 : 1;
        const leftStarts = left.handle.toLowerCase().startsWith(exactHandle);
        const rightStarts = right.handle.toLowerCase().startsWith(exactHandle);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return sortAccountsByDisplayName(left, right);
      })
      .slice(0, 50);
  }, [accountSearchTerm, accounts, isAccountSearch]);
  const profilePosts = useMemo(
    () => (viewedProfileAccount ? posts.filter((post) => post.authorAccountId === viewedProfileAccount.id) : []),
    [posts, viewedProfileAccount],
  );
  const profileLikedPosts = useMemo(() => {
    if (!viewedProfileAccount) return [];
    const likedAtByPostId = new Map<string, string>();
    for (const interaction of interactions) {
      if (interaction.actorAccountId === viewedProfileAccount.id && interaction.type === "like") {
        likedAtByPostId.set(interaction.postId, interaction.createdAt);
      }
    }
    return posts
      .filter((post) => likedAtByPostId.has(post.id))
      .sort((a, b) => {
        const aTime = new Date(likedAtByPostId.get(a.id) ?? a.createdAt).getTime();
        const bTime = new Date(likedAtByPostId.get(b.id) ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [interactions, posts, viewedProfileAccount]);
  const profileMediaPosts = useMemo(() => profilePosts.filter((post) => Boolean(post.imageUrl)), [profilePosts]);
  const profileVisiblePosts =
    profileTab === "likes" ? profileLikedPosts : profileTab === "media" ? profileMediaPosts : profilePosts;
  const profileFollowerAccounts = useMemo(() => {
    if (!viewedProfileAccount) return [];
    const explicitFollowers = accounts.filter((account) => {
      if (account.id === viewedProfileAccount.id) return false;
      const followingAccountIds = readStringArray(account.settings?.followingAccountIds);
      return followingAccountIds.includes(viewedProfileAccount.id);
    });
    const personaFollowsViewedProfile =
      !viewingOwnProfile &&
      personaAccount &&
      viewedProfileAccount.kind === "character" &&
      followedAccountIds.has(viewedProfileAccount.id)
        ? [personaAccount]
        : [];
    return uniqueAccountsById([...explicitFollowers, ...personaFollowsViewedProfile]).sort(sortAccountsByDisplayName);
  }, [accounts, followedAccountIds, personaAccount, viewedProfileAccount, viewingOwnProfile]);
  const profileFollowingAccounts = useMemo(() => {
    if (viewingOwnProfile) {
      const explicitFollowing = readStringArray(personaAccount?.settings?.followingAccountIds).map((id) =>
        accountById.get(id),
      );
      return uniqueAccountsById(explicitFollowing).sort(sortAccountsByDisplayName);
    }
    if (!viewedProfileAccount) return [];
    const followingIds = new Set(readStringArray(viewedProfileAccount.settings?.followingAccountIds));
    return uniqueAccountsById([...followingIds].map((id) => accountById.get(id))).sort(sortAccountsByDisplayName);
  }, [accountById, personaAccount, viewedProfileAccount, viewingOwnProfile]);
  const profileFollowerCount = profileFollowerAccounts.length;
  const profileFollowingCount = profileFollowingAccounts.length;
  const profileConnectionAccounts =
    profileConnectionTab === "following" ? profileFollowingAccounts : profileFollowerAccounts;
  const notificationLikes = useMemo(() => {
    if (!personaAccount) return [];
    const personaPostIds = new Set(
      posts.filter((post) => post.authorAccountId === personaAccount.id).map((post) => post.id),
    );
    return interactions
      .filter(
        (interaction) =>
          interaction.type === "like" &&
          interaction.actorAccountId !== personaAccount.id &&
          personaPostIds.has(interaction.postId),
      )
      .map((interaction) => ({
        interaction,
        post: postById.get(interaction.postId) ?? null,
        actorAccount: accountById.get(interaction.actorAccountId) ?? null,
        actorSnapshot: interaction.actorSnapshot,
      }))
      .filter((item): item is typeof item & { post: NoodlePost } => Boolean(item.post))
      .sort(
        (left, right) =>
          new Date(right.interaction.createdAt).getTime() - new Date(left.interaction.createdAt).getTime(),
      );
  }, [accountById, interactions, personaAccount, postById, posts]);
  const notificationFollowAccounts = useMemo(() => {
    if (!personaAccount) return [];
    return accounts
      .filter((account) => {
        if (account.id === personaAccount.id) return false;
        const followingAccountIds = readStringArray(account.settings?.followingAccountIds);
        return followingAccountIds.includes(personaAccount.id);
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [accounts, personaAccount]);
  const notificationReplyItems = useMemo(() => {
    if (!personaAccount) return [];
    const items: Array<{
      id: string;
      kind: "reply" | "mention";
      createdAt: string;
      actorAccount: NoodleAccount | null;
      actorSnapshot: NoodlePost["authorSnapshot"];
      post: NoodlePost;
      content: string;
    }> = [];
    const seen = new Set<string>();
    for (const interaction of interactions) {
      if (interaction.type !== "reply" || interaction.actorAccountId === personaAccount.id) continue;
      const post = postById.get(interaction.postId);
      if (!post) continue;
      const repliesToPersona = post.authorAccountId === personaAccount.id;
      const mentionsPersona = textMentionsHandle(interaction.content, personaAccount.handle);
      if (!repliesToPersona && !mentionsPersona) continue;
      const id = `reply:${interaction.id}`;
      seen.add(id);
      items.push({
        id,
        kind: repliesToPersona ? "reply" : "mention",
        createdAt: interaction.createdAt,
        actorAccount: accountById.get(interaction.actorAccountId) ?? null,
        actorSnapshot: interaction.actorSnapshot,
        post,
        content: interaction.content ?? "",
      });
    }
    for (const post of posts) {
      if (post.authorAccountId === personaAccount.id || !textMentionsHandle(post.content, personaAccount.handle)) {
        continue;
      }
      const id = `post:${post.id}`;
      if (seen.has(id)) continue;
      items.push({
        id,
        kind: "mention",
        createdAt: post.createdAt,
        actorAccount: accountById.get(post.authorAccountId) ?? null,
        actorSnapshot: post.authorSnapshot,
        post,
        content: post.content,
      });
    }
    return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [accountById, interactions, personaAccount, postById, posts]);
  const notificationCount =
    notificationLikes.length + notificationFollowAccounts.length + notificationReplyItems.length;
  const notificationBadgeLabel = notificationCount > 99 ? "99+" : String(notificationCount);
  const followableCharacterAccounts = useMemo(
    () =>
      accounts
        .filter(
          (account) =>
            account.kind === "character" &&
            hasGeneratedProfile(account) &&
            (account.invited || folderInvitedCharacterIds.has(account.entityId)),
        )
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [accounts, folderInvitedCharacterIds],
  );
  const suggestedCharacters = useMemo(
    () =>
      followableCharacterAccounts
        .filter((account) => !followedAccountIds.has(account.id))
        .map((account) => ({
          account,
          accountId: account.id,
          name: account.displayName,
          handle: account.handle,
          avatarUrl: account.avatarUrl,
        }))
        .slice(0, 5),
    [followableCharacterAccounts, followedAccountIds],
  );

  const openProfile = (account: NoodleAccount | null) => {
    if (!account) return;
    setViewedProfileAccountId(account.id === personaAccount?.id ? null : account.id);
    setProfileEditing(false);
    setProfileTab("posts");
    setProfileConnectionTab(null);
    setActiveNoodleView("profile");
    setAccountSwitcherOpen(false);
  };

  const openOwnProfile = () => {
    setViewedProfileAccountId(null);
    setProfileEditing(false);
    setProfileTab("posts");
    setProfileConnectionTab(null);
    setActiveNoodleView("profile");
    setAccountSwitcherOpen(false);
  };

  const handleSearchChange = (value: string) => {
    setPostSearch(value);
    if (!value.trim()) return;
    setActiveNoodleView("home");
    setAccountSwitcherOpen(false);
    setProfileConnectionTab(null);
  };

  const updateFollowedAccount = (account: NoodleAccount, followed: boolean) => {
    if (!personaAccount || account.id === personaAccount.id) return;
    const currentFollowingAccountIds = readStringArray(personaAccount.settings?.followingAccountIds);
    const nextFollowingAccountIds = followed
      ? Array.from(new Set([...currentFollowingAccountIds, account.id]))
      : currentFollowingAccountIds.filter((id) => id !== account.id);
    updateAccount.mutate(
      {
        id: personaAccount.id,
        settings: { ...personaAccount.settings, followingAccountIds: nextFollowingAccountIds },
      },
      {
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update followed accounts."),
      },
    );
  };

  const submitPost = () => {
    if (!personaAccount || !canSubmitPost) return;
    const content = composer.trim() || "Shared an image.";
    createPost.mutate(
      {
        authorKind: "persona",
        authorEntityId: personaAccount.entityId,
        content,
        imageUrl: attachedImageUrl.trim() || null,
      },
      {
        onSuccess: () => {
          setComposer("");
          setAttachedImageUrl("");
          setActiveComposerTool(null);
          setComposeOpen(false);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not post to Noodle."),
      },
    );
  };

  const reactToPost = (post: NoodlePost, type: NoodleInteractionType, active = false) => {
    if (!personaAccount) return;
    if (active && (type === "like" || type === "repost")) {
      removeInteraction.mutate(
        {
          postId: post.id,
          actorKind: "persona",
          actorEntityId: personaAccount.entityId,
          type,
        },
        {
          onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle post."),
        },
      );
      return;
    }
    createInteraction.mutate(
      {
        postId: post.id,
        actorKind: "persona",
        actorEntityId: personaAccount.entityId,
        type,
        content: type === "reply" ? replyText.trim() : null,
      },
      {
        onSuccess: () => {
          if (type === "reply") {
            setReplyPostId(null);
            setReplyText("");
          }
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update Noodle post."),
      },
    );
  };

  const startEditingPost = (post: NoodlePost) => {
    setEditingPostId(post.id);
    setEditingPostContent(post.content);
    setPostMenuId(null);
  };

  const cancelEditingPost = () => {
    setEditingPostId(null);
    setEditingPostContent("");
  };

  const saveEditedPost = (post: NoodlePost) => {
    const content = editingPostContent.trim();
    if (!content) {
      toast.error("Posts cannot be empty.");
      return;
    }
    updatePost.mutate(
      { id: post.id, content },
      {
        onSuccess: () => cancelEditingPost(),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not edit Noodle post."),
      },
    );
  };

  const deleteNoodlePost = (post: NoodlePost) => {
    setPostMenuId(null);
    setConfirmAction({
      kind: "delete-post",
      postId: post.id,
      title: "Delete Noodle Post",
      message: "This removes the post and its likes, reposts, replies, and activity note.",
      confirmLabel: "Delete post",
    });
  };

  const resetTimeline = () => {
    setConfirmAction({
      kind: "reset-timeline",
      title: "Reset Noodle Timeline",
      message:
        "This removes all posts, replies, likes, reposts, activity digests, and refresh records. Profiles, follows, invites, and settings stay.",
      confirmLabel: "Reset timeline",
    });
  };

  const confirmNoodleAction = () => {
    if (!confirmAction) return;
    if (confirmAction.kind === "delete-post") {
      const postId = confirmAction.postId;
      deletePost.mutate(postId, {
        onSuccess: () => {
          if (replyPostId === postId) {
            setReplyPostId(null);
            setReplyText("");
          }
          if (editingPostId === postId) cancelEditingPost();
          setConfirmAction(null);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not delete Noodle post."),
      });
      return;
    }
    resetNoodleTimeline.mutate(undefined, {
      onSuccess: () => {
        setReplyPostId(null);
        setReplyText("");
        setPostMenuId(null);
        cancelEditingPost();
        setConfirmAction(null);
        toast.success("Noodle timeline reset.");
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reset Noodle timeline."),
    });
  };

  const triggerRefresh = () => {
    if (!settings?.generationConnectionId) {
      toast.error("Choose a generation connection for Noodle first.");
      return;
    }
    const defaultImageConnectionId = readString(imageConnections.find((connection) => connection.defaultForAgents)?.id);
    if (settings.enableImagePrompts && !settings.imageGenerationConnectionId && !defaultImageConnectionId) {
      toast.error("Choose an image generation connection for Noodle first.");
      return;
    }
    refreshNoodle.mutate(
      { personaId: personaAccount?.entityId, connectionId: settings.generationConnectionId },
      {
        onSuccess: () => toast.success("Noodle timeline refreshed."),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not refresh Noodle."),
      },
    );
  };

  const closeComposeModal = useCallback(() => {
    setComposeOpen(false);
    setActiveComposerTool(null);
  }, []);

  const scrollTimelineToTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      timelineScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, []);

  const openHomeTimeline = useCallback(() => {
    setActiveNoodleView("home");
    setAccountSwitcherOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
    scrollTimelineToTop();
  }, [scrollTimelineToTop]);

  const openNotifications = () => {
    setActiveNoodleView("notifications");
    setAccountSwitcherOpen(false);
    setActiveComposerTool(null);
    setProfileConnectionTab(null);
  };

  const normalizedInviteSearch = inviteSearch.trim().toLowerCase();
  const filteredCharacters = useMemo(
    () =>
      characters
        .filter((character) => readString(character.id))
        .filter((character) => characterName(character).toLowerCase().includes(normalizedInviteSearch))
        .sort((left, right) => characterName(left).localeCompare(characterName(right))),
    [characters, normalizedInviteSearch],
  );
  const visibleInviteCharacters = filteredCharacters.slice(0, inviteCharacterLimit);
  const hasMoreInviteCharacters = filteredCharacters.length > visibleInviteCharacters.length;
  const filteredCharacterGroups = useMemo(
    () =>
      characterGroups
        .filter((group) => readString(group.id))
        .filter((group) => characterGroupName(group).toLowerCase().includes(normalizedInviteSearch))
        .sort((left, right) => characterGroupName(left).localeCompare(characterGroupName(right)))
        .slice(0, 24),
    [characterGroups, normalizedInviteSearch],
  );
  const carryoverTargets = useMemo(
    () => new Set(settings?.carryoverModes ?? carryoverTargetsFromLegacy(settings?.carryoverMode)),
    [settings?.carryoverMode, settings?.carryoverModes],
  );

  const toggleCharacterGroupInvite = (groupId: string) => {
    if (!settings) return;
    const current = settings.invitedCharacterGroupIds ?? [];
    const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId];
    saveSettings({ invitedCharacterGroupIds: next });
  };

  const inviteSelectedFolderCharacters = () => {
    if (uninvitedSelectedFolderCharacterIds.length === 0) {
      toast.info("Selected folder characters are already invited.");
      return;
    }
    inviteCharacters.mutate(uninvitedSelectedFolderCharacterIds, {
      onSuccess: (accounts) => {
        toast.success(
          `Invited ${accounts.length} ${accounts.length === 1 ? "character" : "characters"} from selected folders.`,
        );
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not invite folder characters."),
    });
  };

  const toggleCarryoverTarget = (target: NoodleCarryoverTarget, checked: boolean) => {
    if (!settings) return;
    const current = new Set(settings.carryoverModes ?? carryoverTargetsFromLegacy(settings.carryoverMode));
    if (checked) current.add(target);
    else current.delete(target);
    const next = NOODLE_CARRYOVER_TARGETS.filter((mode) => current.has(mode));
    saveSettings({
      carryoverModes: next,
      carryoverMode: legacyCarryoverModeFromTargets(next),
    });
  };

  useEffect(() => {
    if (!composeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeComposeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composeOpen, closeComposeModal]);

  useEffect(() => {
    if (!accountSwitcherOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountSwitcherOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (accountSwitcherRef.current?.contains(event.target)) return;
      setAccountSwitcherOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [accountSwitcherOpen]);

  const settingsContent = (
    <>
      <Section
        title="Invites"
        help="Choose who can participate in Noodle refreshes. Direct character invites, selected character folders, and optional random users form the pool the generator can draw from."
      >
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <FieldLabel help="Filters both character folders and individual characters in this invite section.">
              Characters to Invite
            </FieldLabel>
            <input
              value={inviteSearch}
              onChange={(event) => setInviteSearch(event.target.value)}
              className={fieldClass}
              placeholder="Search characters or folders"
            />
          </label>

          {characterGroups.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setInviteFoldersOpen((open) => !open)}
                className="flex w-full items-center gap-2 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--noodle-blue)]/60"
                aria-expanded={inviteFoldersOpen}
              >
                <FolderOpen size={15} className="shrink-0 text-[var(--noodle-blue)]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Add from Folder</span>
                  <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                    Invite every character in selected folders.
                  </span>
                </span>
                <ChevronRight
                  size={15}
                  className={cn(
                    "shrink-0 text-[var(--muted-foreground)] transition-transform",
                    inviteFoldersOpen && "rotate-90",
                  )}
                />
              </button>
              {inviteFoldersOpen && (
                <div className="overflow-hidden rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)]">
                  <div className="max-h-44 space-y-2 overflow-y-auto p-2 [scrollbar-gutter:stable]">
                    {filteredCharacterGroups.length > 0 ? (
                      filteredCharacterGroups.map((group) => {
                        const id = readString(group.id);
                        const name = characterGroupName(group);
                        const memberCount = readStringArray(group.characterIds).length;
                        const selected = selectedCharacterGroupIds.has(id);
                        const description = readString(group.description).trim();
                        return (
                          <label
                            key={id}
                            className="flex items-center gap-3 rounded-md p-2 text-xs hover:bg-foreground/5"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!settings || updateSettings.isPending}
                              onChange={() => toggleCharacterGroupInvite(id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold">{name}</span>
                              <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                                {memberCount} {memberCount === 1 ? "character" : "characters"}
                                {description ? `, ${description}` : ""}
                              </span>
                            </span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">No matching folders.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={inviteSelectedFolderCharacters}
                    disabled={
                      !settings ||
                      updateSettings.isPending ||
                      inviteCharacters.isPending ||
                      uninvitedSelectedFolderCharacterIds.length === 0
                    }
                    className="flex min-h-10 w-full items-center justify-center gap-2 border-t border-[var(--marinara-chat-chrome-panel-border)] px-3 py-2 text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inviteCharacters.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <UserPlus size={14} />
                    )}
                    {folderInviteButtonLabel}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <FieldLabel help="Directly invited characters are eligible regardless of folder selection and get priority in Noodle suggestions and generated activity.">
              Characters
            </FieldLabel>
            <div className="max-h-96 overflow-y-auto rounded-md border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] [scrollbar-gutter:stable]">
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-[var(--marinara-chat-chrome-panel-border)] p-2 text-left transition-colors hover:bg-foreground/5"
                disabled={!settings || updateSettings.isPending}
                onClick={() => saveSettings({ allowRandomUsers: !(settings?.allowRandomUsers ?? false) })}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--noodle-blue)]/10 text-[var(--noodle-blue)]">
                  <Dices size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Random users</span>
                  <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                    {(settings?.allowRandomUsers ?? false) ? "Enabled" : "Ambient fake profiles"}
                  </span>
                </span>
                <span className={iconButtonClass}>
                  {(settings?.allowRandomUsers ?? false) ? <UserMinus size={15} /> : <UserPlus size={15} />}
                </span>
              </button>
              {visibleInviteCharacters.map((character) => {
                const id = readString(character.id);
                const name = characterName(character);
                const account = characterAccountByEntity.get(id);
                const invited = account?.invited === true;
                const includedByFolder = folderInvitedCharacterIds.has(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 border-b border-[var(--marinara-chat-chrome-panel-border)] p-2 last:border-b-0"
                  >
                    <Avatar
                      account={{ displayName: name, avatarUrl: readString(character.avatarPath) || null }}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{name}</p>
                      <p className="text-[0.68rem] text-[var(--muted-foreground)]">
                        {invited ? "Invited" : includedByFolder ? "Included by folder" : "Not invited"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={iconButtonClass}
                      disabled={inviteCharacter.isPending || removeCharacter.isPending}
                      onClick={() =>
                        invited
                          ? removeCharacter.mutate(id, {
                              onError: (error) =>
                                toast.error(error instanceof Error ? error.message : "Could not remove invite."),
                            })
                          : inviteCharacter.mutate(id, {
                              onError: (error) =>
                                toast.error(error instanceof Error ? error.message : "Could not invite character."),
                            })
                      }
                      title={invited ? "Remove direct invite" : "Invite directly"}
                    >
                      {invited ? <UserMinus size={15} /> : <UserPlus size={15} />}
                    </button>
                  </div>
                );
              })}
              {filteredCharacters.length === 0 && (
                <p className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">No matching characters.</p>
              )}
              {hasMoreInviteCharacters && (
                <button
                  type="button"
                  onClick={() => setInviteCharacterLimit((limit) => limit + NOODLE_INVITE_PAGE_SIZE)}
                  className="w-full px-3 py-2 text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                >
                  Load more ({visibleInviteCharacters.length} of {filteredCharacters.length})
                </button>
              )}
            </div>
          </div>
        </div>
      </Section>

      {settings && (
        <>
          <Section
            title="Refresh"
            help="Controls the model connection and how often Noodle can create a fresh timeline update."
          >
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <FieldLabel help="The text-generation connection used to write new Noodle posts, replies, reposts, likes, and activity digests.">
                  Generation connection
                </FieldLabel>
                <select
                  value={settings.generationConnectionId ?? ""}
                  onChange={(event) => saveSettings({ generationConnectionId: event.target.value || null })}
                  className={fieldClass}
                >
                  <option value="">Choose connection</option>
                  {connections.map((connection) => (
                    <option key={String(connection.id)} value={String(connection.id)}>
                      {String(connection.name ?? connection.model ?? "Connection")}
                    </option>
                  ))}
                </select>
              </label>
              <NumberSetting
                label="Refreshes/day"
                help="How many timeline refreshes Noodle is allowed to create per day when automated refresh scheduling is used. Set 0 to turn automated refreshes off."
                value={settings.refreshesPerDay}
                min={0}
                max={24}
                onCommit={(value) => saveSettings({ refreshesPerDay: value })}
              />
            </div>
          </Section>

          <Section
            title="Active Accounts"
            help="Controls how many eligible characters or random users are active during one generation of the timeline."
          >
            <div className="space-y-3">
              <label className="block space-y-1.5">
                <FieldLabel help="Selects how many invited characters or random users are active during one timeline generation. All uses every eligible account, Random range chooses between Min active and Max active, and Exact count uses one fixed count.">
                  Active selection
                </FieldLabel>
                <select
                  value={settings.participantSelectionMode}
                  onChange={(event) =>
                    saveSettings({
                      participantSelectionMode: event.target
                        .value as NoodleSettingsUpdateInput["participantSelectionMode"],
                    })
                  }
                  className={fieldClass}
                >
                  <option value="random_range">Random range</option>
                  <option value="exact">Exact count</option>
                  <option value="all">All invited</option>
                </select>
              </label>
              {settings.participantSelectionMode === "random_range" && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberSetting
                    label="Min active"
                    help="Lowest number of eligible character or random-user accounts that can participate in one timeline generation."
                    value={settings.participantMin}
                    min={1}
                    max={100}
                    onCommit={(value) => saveSettings({ participantMin: value })}
                  />
                  <NumberSetting
                    label="Max active"
                    help="Highest number of eligible character or random-user accounts that can participate in one timeline generation."
                    value={settings.participantMax}
                    min={1}
                    max={100}
                    onCommit={(value) => saveSettings({ participantMax: value })}
                  />
                </div>
              )}
              {settings.participantSelectionMode === "exact" && (
                <NumberSetting
                  label="Active count"
                  help="Exact number of eligible character or random-user accounts that participate in one timeline generation."
                  value={settings.participantMax}
                  min={1}
                  max={100}
                  onCommit={(value) => saveSettings({ participantMin: value, participantMax: value })}
                />
              )}
            </div>
          </Section>

          <Section title="Activity" help="Limits how much generated Noodle activity one refresh may create.">
            <div className="grid grid-cols-2 gap-2">
              <NumberSetting
                label="Posts"
                help="Maximum new top-level posts the model may create in one refresh."
                value={settings.maxGeneratedPostsPerRefresh}
                min={0}
                max={100}
                onCommit={(value) => saveSettings({ maxGeneratedPostsPerRefresh: value })}
              />
              <NumberSetting
                label="Replies"
                help="Maximum reply interactions the model may add in one refresh."
                value={settings.maxRepliesPerRefresh}
                min={0}
                max={200}
                onCommit={(value) => saveSettings({ maxRepliesPerRefresh: value })}
              />
              <NumberSetting
                label="Reposts"
                help="Maximum repost interactions the model may add in one refresh."
                value={settings.maxRepostsPerRefresh}
                min={0}
                max={100}
                onCommit={(value) => saveSettings({ maxRepostsPerRefresh: value })}
              />
              <NumberSetting
                label="Likes"
                help="Maximum like interactions the model may add in one refresh."
                value={settings.maxLikesPerRefresh}
                min={0}
                max={500}
                onCommit={(value) => saveSettings({ maxLikesPerRefresh: value })}
              />
            </div>
          </Section>

          <Section
            title="Image Generation"
            help="Controls generated post images and whether characters can reuse existing gallery images."
          >
            <div className="space-y-3">
              <ToggleSetting
                label="Image generation"
                help="Generates actual post images from Noodle visual requests, using image connection defaults and the global image style profile system."
                checked={settings.enableImagePrompts}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ enableImagePrompts: checked })}
              />
              {settings.enableImagePrompts && (
                <>
                  <label className="block space-y-1.5">
                    <FieldLabel help="The image-generation connection used to create Noodle post images. Leaving it as Default uses the connection marked default for image generation.">
                      Image generation connection
                    </FieldLabel>
                    <select
                      value={settings.imageGenerationConnectionId ?? ""}
                      onChange={(event) => saveSettings({ imageGenerationConnectionId: event.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">Default image generation connection</option>
                      {imageConnections.map((connection) => (
                        <option key={String(connection.id)} value={String(connection.id)}>
                          {String(connection.name ?? connection.model ?? "Image connection")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <FieldLabel help="Extra instructions passed into the Noodle Post Image prompt override. The full template is also available in Settings, Generations, Image Generation Prompt Overrides.">
                      Prompt instructions
                    </FieldLabel>
                    <textarea
                      value={imageGenerationPromptDraft}
                      onChange={(event) => setImageGenerationPromptDraft(event.target.value)}
                      onBlur={() => {
                        if (imageGenerationPromptDraft !== settings.imageGenerationPrompt) {
                          saveSettings({ imageGenerationPrompt: imageGenerationPromptDraft });
                        }
                      }}
                      className={textareaClass}
                    />
                  </label>
                  <ToggleSetting
                    label="Use avatar references"
                    help="Sends character avatars or preferred full-body references to the image provider when a character's post image is generated."
                    checked={settings.imageGenerationUseAvatarReferences}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => saveSettings({ imageGenerationUseAvatarReferences: checked })}
                  />
                  <ToggleSetting
                    label="Include descriptions"
                    help="Adds character appearance and description notes to the final image prompt before style-profile compilation."
                    checked={settings.imageGenerationIncludeDescriptions}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => saveSettings({ imageGenerationIncludeDescriptions: checked })}
                  />
                  <NumberSetting
                    label="Images/day"
                    help="Maximum number of generated post images Noodle may create across today's timeline posts."
                    value={settings.maxImagePromptsPerDay}
                    min={0}
                    max={50}
                    onCommit={(value) => saveSettings({ maxImagePromptsPerDay: value })}
                  />
                </>
              )}
              <ToggleSetting
                label="Attach gallery images"
                help="Lets characters attach existing images from their own galleries or chats they are in when the timeline writer asks for a gallery attachment."
                checked={settings.allowGalleryImageAttachments}
                disabled={updateSettings.isPending}
                onChange={(checked) => saveSettings({ allowGalleryImageAttachments: checked })}
              />
            </div>
          </Section>

          <Section
            title="Carryover"
            help="Controls whether recent Noodle activity is appended to chat, roleplay, or game context."
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <FieldLabel help="Toggle each mode that should receive recent Noodle activity involving the current persona or chat characters. When all three are off, nothing is carried into chat context.">
                  Carryover to chats
                </FieldLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  <ToggleSetting
                    label="Conversations"
                    checked={carryoverTargets.has("conversation")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("conversation", checked)}
                  />
                  <ToggleSetting
                    label="Roleplays"
                    checked={carryoverTargets.has("roleplay")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("roleplay", checked)}
                  />
                  <ToggleSetting
                    label="Games"
                    checked={carryoverTargets.has("game")}
                    disabled={updateSettings.isPending}
                    onChange={(checked) => toggleCarryoverTarget("game", checked)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberSetting
                  label="Carry hours"
                  help="How far back Noodle looks for activity digests when adding recent social media context to chats."
                  value={settings.carryoverHours}
                  min={1}
                  max={720}
                  onCommit={(value) => saveSettings({ carryoverHours: value })}
                />
                <NumberSetting
                  label="Carry items"
                  help="Maximum number of recent Noodle activity summaries appended to a chat context."
                  value={settings.carryoverMaxItems}
                  min={1}
                  max={50}
                  onCommit={(value) => saveSettings({ carryoverMaxItems: value })}
                />
              </div>
            </div>
          </Section>

          <Section
            title="Reset Noodle"
            help="Clears timeline content while keeping profiles, follows, invites, and Noodle settings."
          >
            <button
              type="button"
              onClick={resetTimeline}
              disabled={resetNoodleTimeline.isPending}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--destructive)]/45 bg-[var(--background)] px-3 py-2 text-xs font-semibold text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resetNoodleTimeline.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} className="text-[var(--destructive)]" />
              )}
              {resetNoodleTimeline.isPending ? "Resetting Noodle" : "Reset Noodle Timeline"}
            </button>
          </Section>
        </>
      )}
    </>
  );

  const renderPostArticle = (post: NoodlePost) => {
    const authorAccount = accountById.get(post.authorAccountId) ?? null;
    const author = authorAccount ?? post.authorSnapshot;
    const postInteractions = interactions.filter((interaction) => interaction.postId === post.id);
    const likedByPersona = personaAccount
      ? postInteractions.some(
          (interaction) => interaction.type === "like" && interaction.actorAccountId === personaAccount.id,
        )
      : false;
    const repostedByPersona = personaAccount
      ? postInteractions.some(
          (interaction) => interaction.type === "repost" && interaction.actorAccountId === personaAccount.id,
        )
      : false;
    const replies = postInteractions.filter((interaction) => interaction.type === "reply");
    return (
      <article
        key={post.id}
        className="border-b border-[var(--noodle-divider)] px-4 py-4 transition-colors hover:bg-[var(--accent)]/35"
      >
        <div className="flex gap-3">
          {author ? (
            <button
              type="button"
              onClick={() => openProfile(authorAccount)}
              disabled={!authorAccount}
              className="h-fit rounded-full text-left transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
              title={authorAccount ? `View @${authorAccount.handle}` : undefined}
            >
              <Avatar account={{ displayName: author.displayName, avatarUrl: author.avatarUrl }} />
            </button>
          ) : (
            <AtSign size={28} className="text-[var(--noodle-blue)]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => openProfile(authorAccount)}
                  disabled={!authorAccount}
                  className="font-semibold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
                >
                  {author?.displayName ?? "Noodle User"}
                </button>
                <span className="text-xs text-[var(--muted-foreground)]">@{author?.handle ?? "noodle"}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{formatTime(post.createdAt)}</span>
              </div>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPostMenuId((current) => (current === post.id ? null : post.id))}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                  title="Post actions"
                  aria-label="Post actions"
                >
                  <MoreHorizontal size={18} />
                </button>
                {postMenuId === post.id && (
                  <div className="absolute right-0 top-[calc(100%+0.25rem)] z-30 min-w-32 overflow-hidden rounded-lg border border-[var(--noodle-divider)] bg-[var(--background)] py-1 text-xs shadow-2xl shadow-black/30">
                    <button
                      type="button"
                      onClick={() => startEditingPost(post)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]"
                    >
                      <Pencil size={14} className="text-[var(--noodle-blue)]" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteNoodlePost(post)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--accent)]"
                    >
                      <Trash2 size={14} className="text-[var(--noodle-blue)]" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            {editingPostId === post.id ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={editingPostContent}
                  onChange={(event) => setEditingPostContent(event.target.value)}
                  className={cn(textareaClass, "min-h-28")}
                  placeholder="Edit post"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEditingPost}
                    className="h-8 rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEditedPost(post)}
                    disabled={!editingPostContent.trim() || updatePost.isPending}
                    className="h-8 rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatePost.isPending ? "Saving" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{post.content}</p>
            )}
            {post.imageUrl ? (
              <img src={post.imageUrl} alt="" className="mt-3 max-h-96 w-full rounded-xl object-cover" />
            ) : post.imagePrompt ? (
              <div className="mt-3 rounded-xl border border-[var(--noodle-blue)]/35 bg-[var(--noodle-blue)]/10 p-3 text-xs leading-5">
                <span className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--noodle-blue)]">
                  <ImageIcon size={13} />
                  Image prompt
                </span>
                {post.imagePrompt}
              </div>
            ) : null}

            <div className="mt-3 flex max-w-md items-center justify-between gap-1">
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full", likedByPersona && "bg-[var(--noodle-blue)]/10")}
                disabled={!personaAccount || createInteraction.isPending || removeInteraction.isPending}
                onClick={() => reactToPost(post, "like", likedByPersona)}
                title={likedByPersona ? "Unlike" : "Like"}
              >
                <Heart size={18} />
                {countInteractions(postInteractions, "like")}
              </button>
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full", repostedByPersona && "bg-[var(--noodle-blue)]/10")}
                disabled={!personaAccount || createInteraction.isPending || removeInteraction.isPending}
                onClick={() => reactToPost(post, "repost", repostedByPersona)}
                title={repostedByPersona ? "Undo repost" : "Repost"}
              >
                <Repeat2 size={24} strokeWidth={1.55} className="-my-1" />
                {countInteractions(postInteractions, "repost")}
              </button>
              <button
                type="button"
                className={cn(iconButtonClass, "rounded-full hover:text-[var(--noodle-blue)]")}
                disabled={!personaAccount}
                onClick={() => setReplyPostId((current) => (current === post.id ? null : post.id))}
                title="Reply"
              >
                <MessageCircle size={18} />
                {replies.length}
              </button>
            </div>

            {replyPostId === post.id && (
              <div className="mt-3 flex gap-2">
                <input
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  className={fieldClass}
                  placeholder="Reply as your persona"
                />
                <button
                  type="button"
                  className="h-9 rounded-full bg-[var(--noodle-blue)] px-3 text-xs font-bold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!replyText.trim() || createInteraction.isPending}
                  onClick={() => reactToPost(post, "reply")}
                >
                  <Send size={14} />
                </button>
              </div>
            )}

            {replies.length > 0 && (
              <div className="mt-3 space-y-2 border-l border-[var(--noodle-divider)] pl-3">
                {replies.map((reply) => {
                  const actorAccount = accountById.get(reply.actorAccountId) ?? null;
                  const actor = actorAccount ?? reply.actorSnapshot;
                  return (
                    <div key={reply.id} className="flex gap-2 text-xs">
                      {actor && (
                        <button
                          type="button"
                          onClick={() => openProfile(actorAccount)}
                          disabled={!actorAccount}
                          className="h-fit rounded-full text-left transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
                          title={actorAccount ? `View @${actorAccount.handle}` : undefined}
                        >
                          <Avatar account={{ displayName: actor.displayName, avatarUrl: actor.avatarUrl }} size="sm" />
                        </button>
                      )}
                      <div className="min-w-0 rounded-xl bg-[var(--card)] px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openProfile(actorAccount)}
                          disabled={!actorAccount}
                          className="font-semibold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
                        >
                          {actor?.displayName ?? "Noodle User"}
                        </button>
                        <p className="mt-1 whitespace-pre-wrap leading-5">{reply.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  };

  const renderAccountRow = (account: NoodleAccount, options?: { showFollowButton?: boolean }) => {
    const followable = canFollowAccount(account);
    const followed = followedAccountIds.has(account.id);
    return (
      <div
        key={account.id}
        className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-3 last:border-b-0"
      >
        <button
          type="button"
          onClick={() => openProfile(account)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left transition-colors hover:text-[var(--noodle-blue)]"
        >
          <Avatar account={account} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">{account.displayName}</span>
            <span className="block truncate text-sm text-[var(--muted-foreground)]">@{account.handle}</span>
            {account.bio.trim() && (
              <span className="mt-1 line-clamp-2 block text-sm leading-5 text-[var(--foreground)]">{account.bio}</span>
            )}
          </span>
        </button>
        {options?.showFollowButton && followable ? (
          <button
            type="button"
            onClick={() => updateFollowedAccount(account, !followed)}
            disabled={updateAccount.isPending}
            className={cn(
              "mt-1 h-8 shrink-0 rounded-full px-4 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
              followed
                ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                : "bg-[var(--foreground)] text-[var(--background)]",
            )}
          >
            {followed ? "Following" : "Follow"}
          </button>
        ) : null}
      </div>
    );
  };

  const renderFollowNotification = (account: NoodleAccount) => (
    <div key={account.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
      <button
        type="button"
        onClick={() => openProfile(account)}
        className="rounded-full transition-opacity hover:opacity-80"
        title={`View @${account.handle}`}
      >
        <Avatar account={account} />
      </button>
      <button
        type="button"
        onClick={() => openProfile(account)}
        className="min-w-0 flex-1 text-left transition-colors hover:text-[var(--noodle-blue)]"
      >
        <span className="block truncate text-sm font-bold">{account.displayName}</span>
        <span className="block truncate text-sm text-[var(--muted-foreground)]">@{account.handle}</span>
        <span className="mt-1 block text-sm leading-5">followed you</span>
      </button>
    </div>
  );

  const renderLikeNotification = (item: (typeof notificationLikes)[number]) => {
    const actor = item.actorAccount ?? item.actorSnapshot;
    return (
      <div
        key={item.interaction.id}
        className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4"
      >
        {actor ? (
          <button
            type="button"
            onClick={() => openProfile(item.actorAccount)}
            disabled={!item.actorAccount}
            className="rounded-full transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            title={item.actorAccount ? `View @${item.actorAccount.handle}` : undefined}
          >
            <Avatar account={{ displayName: actor.displayName, avatarUrl: actor.avatarUrl }} />
          </button>
        ) : (
          <Heart size={28} className="text-[var(--noodle-blue)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openProfile(item.actorAccount)}
              disabled={!item.actorAccount}
              className="font-bold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
            >
              {actor?.displayName ?? "Noodle User"}
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.interaction.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">liked your post</p>
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-[var(--muted-foreground)]">{item.post.content}</p>
        </div>
      </div>
    );
  };

  const renderReplyNotification = (item: (typeof notificationReplyItems)[number]) => {
    const actor = item.actorAccount ?? item.actorSnapshot;
    return (
      <div key={item.id} className="flex items-start gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
        {actor ? (
          <button
            type="button"
            onClick={() => openProfile(item.actorAccount)}
            disabled={!item.actorAccount}
            className="rounded-full transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
            title={item.actorAccount ? `View @${item.actorAccount.handle}` : undefined}
          >
            <Avatar account={{ displayName: actor.displayName, avatarUrl: actor.avatarUrl }} />
          </button>
        ) : (
          <MessageCircle size={28} className="text-[var(--noodle-blue)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => openProfile(item.actorAccount)}
              disabled={!item.actorAccount}
              className="font-bold transition-colors enabled:hover:text-[var(--noodle-blue)] disabled:cursor-default"
            >
              {actor?.displayName ?? "Noodle User"}
            </button>
            <span className="text-xs text-[var(--muted-foreground)]">@{actor?.handle ?? "noodle"}</span>
            <span className="text-xs text-[var(--muted-foreground)]">{formatTime(item.createdAt)}</span>
          </div>
          <p className="mt-1 text-sm">{item.kind === "reply" ? "replied to your post" : "mentioned you"}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5">{item.content}</p>
          {item.kind === "reply" && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">{item.post.content}</p>
          )}
        </div>
      </div>
    );
  };

  const renderComposerToolPopovers = ({
    imageRef,
    pollRef,
    mediaRef,
  }: {
    imageRef: RefObject<HTMLDivElement | null>;
    pollRef: RefObject<HTMLDivElement | null>;
    mediaRef: RefObject<HTMLDivElement | null>;
  }) => (
    <>
      {activeComposerTool === "image" && (
        <NoodleToolPopover title="Attach image" anchorRef={imageRef} onClose={() => setActiveComposerTool(null)} wide>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => imageFileRef.current?.click()}
              disabled={uploadGlobalImages.isPending}
              className="h-9 w-full rounded-full bg-[var(--noodle-blue)] px-4 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploadGlobalImages.isPending ? "Uploading..." : "Upload From Device"}
            </button>
            <div className="flex items-center gap-2 text-[0.625rem] font-semibold uppercase tracking-normal text-[var(--marinara-chat-chrome-panel-muted)]">
              <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
              or
              <span className="h-px flex-1 bg-[var(--noodle-divider)]" />
            </div>
            <label className="block space-y-1.5">
              <span className={labelClass}>Image URL</span>
              <input
                value={imageUrlDraft}
                onChange={(event) => setImageUrlDraft(event.target.value)}
                placeholder="https://..."
                className={fieldClass}
              />
            </label>
            <button
              type="button"
              onClick={applyImageUrl}
              className="h-9 w-full rounded-full border border-[var(--noodle-divider)] px-4 text-xs font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
            >
              Attach URL
            </button>
          </div>
        </NoodleToolPopover>
      )}
      {activeComposerTool === "poll" && (
        <NoodleToolPopover title="Create poll" anchorRef={pollRef} onClose={() => setActiveComposerTool(null)} wide>
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className={labelClass}>Question</span>
              <input
                value={pollQuestion}
                onChange={(event) => setPollQuestion(event.target.value)}
                className={fieldClass}
                placeholder="Ask a question"
              />
            </label>
            <div className="space-y-2">
              {pollOptions.map((option, index) => (
                <input
                  key={index}
                  value={option}
                  onChange={(event) =>
                    setPollOptions((current) =>
                      current.map((entry, optionIndex) => (optionIndex === index ? event.target.value : entry)),
                    )
                  }
                  className={fieldClass}
                  placeholder={`Option ${index + 1}`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPollOptions((current) => (current.length >= 4 ? current : [...current, ""]))}
                className="h-8 flex-1 rounded-full border border-[var(--noodle-divider)] px-3 text-xs font-semibold text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
              >
                Add Option
              </button>
              <button
                type="button"
                onClick={applyPoll}
                className="h-8 flex-1 rounded-full bg-[var(--noodle-blue)] px-3 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90"
              >
                Insert Poll
              </button>
            </div>
          </div>
        </NoodleToolPopover>
      )}
      {activeComposerTool === "media" && (
        <NoodleAnchoredPopover anchorRef={mediaRef} wide>
          <ConversationMediaPickerPanel
            tabs={NOODLE_MEDIA_PICKER_TABS}
            activeTab={mediaPickerTab}
            onActiveTabChange={setMediaPickerTab}
            onClose={() => setActiveComposerTool(null)}
            onEmojiSelect={appendToComposer}
            onGifSelect={(gifUrl) => {
              setAttachedImageUrl(gifUrl);
              setActiveComposerTool(null);
            }}
            onStickerSelect={(name) => {
              appendToComposer(`sticker:${name}:`);
              setActiveComposerTool(null);
            }}
            className="w-full !border-[var(--marinara-chat-chrome-panel-border)] !bg-[var(--background)] !text-[var(--foreground)] shadow-2xl shadow-black/35"
          />
        </NoodleAnchoredPopover>
      )}
    </>
  );

  const rightRailContent = (
    <aside className="hidden w-[22rem] shrink-0 px-4 py-3 xl:block">
      <div className="sticky top-3 space-y-4">
        <label className="flex h-11 items-center gap-2 rounded-full border border-[var(--noodle-divider)] bg-[var(--background)] px-4 text-sm transition-colors focus-within:border-[var(--noodle-blue)]">
          <Search size={17} className="shrink-0 text-[var(--noodle-blue)]" />
          <input
            value={postSearch}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Search posts or @users"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
          />
          {postSearch.trim() && (
            <button
              type="button"
              onClick={() => setPostSearch("")}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </label>

        <section className="overflow-hidden rounded-2xl border border-[var(--noodle-divider)] bg-[var(--background)]">
          <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
            <h3 className="text-lg font-bold">Who to follow</h3>
          </div>
          {suggestedCharacters.length > 0 ? (
            <div className="divide-y divide-[var(--noodle-divider)]">
              {suggestedCharacters.map((character) => (
                <div key={character.accountId} className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openProfile(character.account)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-colors hover:text-[var(--noodle-blue)]"
                  >
                    <Avatar account={{ displayName: character.name, avatarUrl: character.avatarUrl }} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{character.name}</span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">@{character.handle}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateFollowedAccount(character.account, true)}
                    disabled={updateAccount.isPending}
                    className="h-8 rounded-full bg-[var(--foreground)] px-4 text-xs font-bold text-[var(--background)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Follow
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-5 text-sm text-[var(--muted-foreground)]">
              {followableCharacterAccounts.length > 0 ? "You're following everyone!" : "No one's cooking yet…"}
            </p>
          )}
        </section>
      </div>
    </aside>
  );

  return (
    <div
      className="mari-chrome-token-scope relative flex h-full min-h-0 flex-col bg-[var(--background)] text-[var(--foreground)]"
      style={
        {
          "--noodle-blue": NOODLE_BLUE,
          "--noodle-divider": "var(--marinara-chat-chrome-panel-divider)",
        } as CSSProperties
      }
    >
      <BrowserChrome />
      <input ref={imageFileRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
        <div className="flex min-h-0 w-full max-w-[1264px] justify-center">
          <aside className="hidden w-[17rem] shrink-0 border-r border-[var(--noodle-divider)] bg-[var(--background)] lg:flex lg:flex-col [&_svg]:!text-[var(--noodle-blue)]">
            <div className="flex min-h-0 flex-1 flex-col px-5 py-4">
              <div className="mb-5 flex h-12 items-center">
                <NoodleLogo className="h-10 w-16" />
              </div>
              <nav className="space-y-1">
                <button
                  type="button"
                  onClick={openHomeTimeline}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    activeNoodleView === "home" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <Home size={22} className="!text-[var(--noodle-blue)]" />
                  Home
                </button>
                <button
                  type="button"
                  onClick={openNotifications}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    activeNoodleView === "notifications" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                    <Bell size={22} className="!text-[var(--noodle-blue)]" />
                    {notificationCount > 0 && (
                      <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-[var(--noodle-blue)] px-1 text-center text-[0.58rem] font-black leading-4 text-zinc-950 ring-2 ring-[var(--background)]">
                        {notificationBadgeLabel}
                      </span>
                    )}
                  </span>
                  Notifications
                </button>
                <button
                  type="button"
                  onClick={openOwnProfile}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    activeNoodleView === "profile" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <User size={22} className="!text-[var(--noodle-blue)]" />
                  Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveNoodleView("settings");
                    setAccountSwitcherOpen(false);
                    setProfileConnectionTab(null);
                  }}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-4 rounded-full px-3 text-left text-[0.95rem] font-semibold hover:bg-[var(--accent)]",
                    activeNoodleView === "settings" && "bg-[var(--noodle-blue)]/10",
                  )}
                >
                  <Settings2 size={22} className="!text-[var(--noodle-blue)]" />
                  Settings
                </button>
              </nav>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true);
                  setActiveComposerTool(null);
                }}
                className="mt-5 h-12 rounded-full bg-[var(--noodle-blue)] px-6 text-sm font-bold text-zinc-950 transition-opacity hover:opacity-90"
              >
                Post
              </button>
              <div ref={accountSwitcherRef} className="relative mt-auto">
                {accountSwitcherOpen && (
                  <div className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-30 overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--background)] p-2 shadow-2xl shadow-black/30">
                    <p className={cn(labelClass, "px-2 pb-2")}>Switch account</p>
                    {sortedPersonaAccounts.length > 0 ? (
                      <div className="max-h-72 space-y-1 overflow-y-auto">
                        {visiblePersonaAccounts.map((account) => {
                          const selected = account.id === personaAccount?.id;
                          return (
                            <button
                              key={account.id}
                              type="button"
                              onClick={() => {
                                setSelectedPersonaId(account.entityId);
                                setViewedProfileAccountId(null);
                                setProfileEditing(false);
                                setProfileTab("posts");
                                setProfileConnectionTab(null);
                                setAccountSwitcherOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--accent)]",
                                selected && "bg-[var(--noodle-blue)]/10",
                              )}
                            >
                              <Avatar account={account} size="sm" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold">{account.displayName}</span>
                                <span className="block truncate text-[0.68rem] text-[var(--muted-foreground)]">
                                  @{account.handle}
                                </span>
                              </span>
                              {selected && <span className="h-2 w-2 rounded-full bg-[var(--noodle-blue)]" />}
                            </button>
                          );
                        })}
                        {hasMorePersonaAccounts && (
                          <button
                            type="button"
                            onClick={() =>
                              setPersonaAccountLimit((current) => current + NOODLE_PERSONA_SWITCHER_PAGE_SIZE)
                            }
                            className="mt-1 h-9 w-full rounded-lg text-xs font-semibold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                          >
                            Load more ({visiblePersonaAccounts.length} of {sortedPersonaAccounts.length})
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="px-2 py-3 text-xs text-[var(--muted-foreground)]">No persona accounts yet.</p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAccountSwitcherOpen((current) => !current)}
                  className="flex min-h-16 w-full items-center gap-3 rounded-full px-3 text-left transition-colors hover:bg-[var(--accent)]"
                  title="Switch account"
                >
                  {personaAccount ? (
                    <Avatar account={personaAccount} />
                  ) : (
                    <AtSign size={28} className="!text-[var(--noodle-blue)]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{personaAccount?.displayName ?? "Noodle Account"}</p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {personaAccount ? `@${personaAccount.handle}` : "Pick a persona"}
                    </p>
                  </div>
                  <MoreHorizontal size={18} className="!text-[var(--noodle-blue)] opacity-70" />
                </button>
              </div>
            </div>
          </aside>

          <main ref={timelineScrollRef} className="min-w-0 flex-1 overflow-y-auto lg:max-w-[640px]">
            <div className="min-h-full w-full border-x border-[var(--noodle-divider)] bg-[var(--background)]">
              {activeNoodleView === "home" &&
                (isAccountSearch ? (
                  <div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 px-4 backdrop-blur">
                    <AtSign size={19} className="text-[var(--noodle-blue)]" />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-bold">Accounts</h2>
                      <p className="truncate text-[0.68rem] text-[var(--muted-foreground)]">
                        {accountSearchTerm ? `@${accountSearchTerm}` : "Type a handle after @"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="sticky top-0 z-20 grid grid-cols-2 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
                    {TIMELINE_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setTimelineTab(tab.id)}
                        className={cn(
                          "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                          timelineTab === tab.id && "text-[var(--foreground)]",
                        )}
                        aria-pressed={timelineTab === tab.id}
                      >
                        {tab.label}
                        {timelineTab === tab.id && (
                          <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                        )}
                      </button>
                    ))}
                  </div>
                ))}

              {activeNoodleView === "home" && !isAccountSearch && (
                <div className="border-b border-[var(--noodle-divider)] px-4 py-3">
                  <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                    {personaAccount ? (
                      <Avatar account={personaAccount} />
                    ) : (
                      <AtSign size={28} className="text-[var(--noodle-blue)]" />
                    )}
                    <div className="min-w-0">
                      <textarea
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        disabled={!personaAccount}
                        placeholder="What's simmering?"
                        className="min-h-20 w-full resize-none border-0 bg-transparent py-2 text-[1rem] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
                      />
                      {attachedImageUrl && (
                        <div className="mb-3 overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/10">
                          <img src={attachedImageUrl} alt="" className="max-h-52 w-full object-cover" />
                          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[var(--noodle-blue)]">
                            <span className="min-w-0 truncate">Attached image</span>
                            <button
                              type="button"
                              onClick={() => setAttachedImageUrl("")}
                              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--noodle-blue)]/15"
                              title="Remove image"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 h-px w-full bg-[var(--noodle-divider)]" />
                  <div className="relative mt-3 flex items-center justify-between gap-2 pl-14">
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <div ref={imageToolRef} className="relative">
                        <NoodleToolButton
                          title="Attach image"
                          active={activeComposerTool === "image"}
                          onClick={() => setActiveComposerTool((current) => (current === "image" ? null : "image"))}
                        >
                          <ImageIcon size={18} />
                        </NoodleToolButton>
                      </div>
                      <div ref={pollToolRef} className="relative">
                        <NoodleToolButton
                          title="Create poll"
                          active={activeComposerTool === "poll"}
                          onClick={() => setActiveComposerTool((current) => (current === "poll" ? null : "poll"))}
                        >
                          <ListChecks size={18} />
                        </NoodleToolButton>
                      </div>
                      <div ref={mediaToolRef} className="relative">
                        <NoodleToolButton
                          title="Emoji, GIFs and stickers"
                          active={activeComposerTool === "media"}
                          onClick={() => setActiveComposerTool((current) => (current === "media" ? null : "media"))}
                        >
                          <Smile size={18} />
                        </NoodleToolButton>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={submitPost}
                      disabled={!canSubmitPost || createPost.isPending}
                      className="h-8 rounded-full bg-[var(--noodle-blue)] px-5 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Post
                    </button>
                    {!composeOpen &&
                      renderComposerToolPopovers({
                        imageRef: imageToolRef,
                        pollRef: pollToolRef,
                        mediaRef: mediaToolRef,
                      })}
                  </div>
                </div>
              )}

              {activeNoodleView === "home" && !isAccountSearch && (
                <div className="border-b border-[var(--noodle-divider)] px-4 py-2">
                  <button
                    type="button"
                    onClick={triggerRefresh}
                    disabled={refreshNoodle.isPending || !settings}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-full text-sm font-bold text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Refresh timeline"
                    aria-label="Refresh timeline"
                  >
                    {refreshNoodle.isPending ? (
                      <Loader2 size={17} className="!text-[var(--noodle-blue)] animate-spin" />
                    ) : (
                      <RefreshCw size={17} className="!text-[var(--noodle-blue)]" />
                    )}
                    {refreshNoodle.isPending ? "Refreshing" : "Refresh timeline"}
                  </button>
                </div>
              )}

              {activeNoodleView === "notifications" ? (
                <div className="min-h-full">
                  <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
                    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                      <Bell size={22} className="text-[var(--noodle-blue)]" />
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">Notifications</h2>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3">
                      {NOTIFICATION_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setNotificationTab(tab.id)}
                          className={cn(
                            "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                            notificationTab === tab.id && "text-[var(--foreground)]",
                          )}
                        >
                          {tab.label}
                          {notificationTab === tab.id && (
                            <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {notificationTab === "likes" ? (
                    notificationLikes.length > 0 ? (
                      <div>{notificationLikes.map(renderLikeNotification)}</div>
                    ) : (
                      <div className="px-8 py-14 text-center">
                        <Heart size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                        <p className="text-base font-bold">No likes yet.</p>
                        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                          Likes on your Noodle posts will show here.
                        </p>
                      </div>
                    )
                  ) : notificationTab === "follows" ? (
                    notificationFollowAccounts.length > 0 ? (
                      <div>{notificationFollowAccounts.map(renderFollowNotification)}</div>
                    ) : (
                      <div className="px-8 py-14 text-center">
                        <Bell size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                        <p className="text-base font-bold">No follows yet.</p>
                        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                          Accounts following you will show here.
                        </p>
                      </div>
                    )
                  ) : notificationReplyItems.length > 0 ? (
                    <div>{notificationReplyItems.map(renderReplyNotification)}</div>
                  ) : (
                    <div className="px-8 py-14 text-center">
                      <MessageCircle size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                      <p className="text-base font-bold">No replies or mentions yet.</p>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                        Replies to your posts and @{personaAccount?.handle ?? "mentions"} will show here.
                      </p>
                    </div>
                  )}
                </div>
              ) : activeNoodleView === "settings" ? (
                <div className="min-h-full">
                  <div className="border-b border-[var(--noodle-divider)] px-4 py-5">
                    <div className="flex items-center gap-3">
                      <Settings2 size={22} className="text-[var(--noodle-blue)]" />
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold">Noodle settings</h2>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {personaAccount ? `@${personaAccount.handle}` : "Choose a persona account"}
                        </p>
                      </div>
                    </div>
                  </div>
                  {settingsContent}
                </div>
              ) : activeNoodleView === "profile" && profileConnectionTab ? (
                <div className="min-h-full">
                  <div className="sticky top-0 z-20 border-b border-[var(--noodle-divider)] bg-[var(--background)]/95 backdrop-blur">
                    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setProfileConnectionTab(null)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--noodle-blue)] transition-colors hover:bg-[var(--noodle-blue)]/10"
                        title="Back to profile"
                        aria-label="Back to profile"
                      >
                        <ChevronLeft size={22} />
                      </button>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold">{profilePreviewAccount.displayName}</h2>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          @{profileDisplayHandle || "noodle"}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2">
                      {PROFILE_CONNECTION_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setProfileConnectionTab(tab.id)}
                          className={cn(
                            "relative flex h-12 items-center justify-center text-sm font-bold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                            profileConnectionTab === tab.id && "text-[var(--foreground)]",
                          )}
                        >
                          {tab.label}
                          {profileConnectionTab === tab.id && (
                            <span className="absolute bottom-0 left-1/2 h-1 w-16 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  {profileConnectionAccounts.length > 0 ? (
                    <div>
                      {profileConnectionAccounts.map((account) =>
                        renderAccountRow(account, { showFollowButton: true }),
                      )}
                    </div>
                  ) : (
                    <div className="px-8 py-14 text-center">
                      <p className="text-base font-bold">
                        {profileConnectionTab === "following" ? "Not following anyone yet." : "No followers yet."}
                      </p>
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                        Nothing boiling here yet.
                      </p>
                    </div>
                  )}
                </div>
              ) : activeNoodleView === "profile" ? (
                <div className="border-b border-[var(--noodle-divider)]">
                  <button
                    type="button"
                    onClick={() => {
                      if (viewingOwnProfile) bannerFileRef.current?.click();
                    }}
                    disabled={!viewingOwnProfile || profileUploadTarget === "banner"}
                    className={cn(
                      "relative block h-40 w-full overflow-hidden bg-[var(--noodle-blue)]/15 text-left disabled:cursor-default",
                      profileUploadTarget === "banner" && "cursor-wait opacity-80",
                    )}
                    title={viewingOwnProfile ? "Upload banner" : undefined}
                  >
                    {profileBannerPreview ? (
                      <img src={profileBannerPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[var(--noodle-blue)]/10">
                        <NoodleLogo className="h-20 w-32 opacity-70" />
                      </div>
                    )}
                    {profileUploadTarget === "banner" && (
                      <span className="absolute bottom-3 right-3 rounded-full bg-[var(--marinara-chat-chrome-panel-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--noodle-blue)] shadow-lg ring-1 ring-[var(--marinara-chat-chrome-panel-border)]">
                        Uploading...
                      </span>
                    )}
                  </button>
                  <input
                    ref={bannerFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => handleProfileImageFile("banner", event)}
                  />

                  <div className="px-4 pb-5">
                    <div className="-mt-10 flex items-end justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (viewingOwnProfile) avatarFileRef.current?.click();
                        }}
                        disabled={!viewingOwnProfile || profileUploadTarget === "avatar"}
                        className={cn(
                          "relative rounded-full bg-[var(--background)] p-1 text-left disabled:cursor-default",
                          profileUploadTarget === "avatar" && "cursor-wait opacity-80",
                        )}
                        title={viewingOwnProfile ? "Upload avatar" : undefined}
                      >
                        <Avatar account={profilePreviewAccount} size="lg" />
                        {profileUploadTarget === "avatar" && (
                          <span className="absolute inset-1 flex items-center justify-center rounded-full bg-black/50 text-[0.625rem] font-semibold text-white">
                            Uploading
                          </span>
                        )}
                      </button>
                      <input
                        ref={avatarFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => handleProfileImageFile("avatar", event)}
                      />
                      {viewingOwnProfile ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditingOwnProfile) saveProfile();
                            else setProfileEditing(true);
                          }}
                          disabled={isEditingOwnProfile ? !canSaveProfile || updateAccount.isPending : !personaAccount}
                          className="mb-1 h-9 rounded-full bg-[var(--noodle-blue)] px-5 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isEditingOwnProfile ? (updateAccount.isPending ? "Saving" : "Save") : "Edit Profile"}
                        </button>
                      ) : canFollowViewedProfile && viewedProfileAccount ? (
                        <button
                          type="button"
                          onClick={() => updateFollowedAccount(viewedProfileAccount, !viewedProfileFollowed)}
                          disabled={updateAccount.isPending}
                          className={cn(
                            "mb-1 h-9 rounded-full px-5 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
                            viewedProfileFollowed
                              ? "border border-[var(--noodle-divider)] text-[var(--foreground)]"
                              : "bg-[var(--foreground)] text-[var(--background)]",
                          )}
                        >
                          {viewedProfileFollowed ? "Following" : "Follow"}
                        </button>
                      ) : null}
                    </div>

                    {isEditingOwnProfile ? (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <label className="block space-y-1.5">
                            <span className={labelClass}>Display name</span>
                            <input
                              value={profileName}
                              onChange={(event) => setProfileName(event.target.value)}
                              className={fieldClass}
                            />
                          </label>
                          <label className="block space-y-1.5">
                            <span className={labelClass}>@name</span>
                            <input
                              value={profileHandle}
                              onChange={(event) => setProfileHandle(event.target.value)}
                              className={fieldClass}
                              placeholder="@mari"
                            />
                          </label>
                        </div>
                        <label className="block space-y-1.5">
                          <span className={labelClass}>Bio</span>
                          <textarea
                            value={profileBio}
                            onChange={(event) => setProfileBio(event.target.value)}
                            className={cn(fieldClass, "h-24 resize-none py-2")}
                          />
                        </label>
                        <label className="block space-y-1.5">
                          <span className={labelClass}>Location</span>
                          <input
                            value={profileLocation}
                            onChange={(event) => setProfileLocation(event.target.value)}
                            className={fieldClass}
                            placeholder="Somewhere cozy"
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <h3 className="text-xl font-bold leading-tight">{profilePreviewAccount.displayName}</h3>
                        <p className="text-sm text-[var(--muted-foreground)]">@{profileDisplayHandle || "noodle"}</p>
                        {profileBioPreview && (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{profileBioPreview}</p>
                        )}
                        {profileLocationPreview && (
                          <p className="mt-3 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]">
                            <MapPin size={15} className="text-[var(--noodle-blue)]" />
                            {profileLocationPreview}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted-foreground)]">
                          <button
                            type="button"
                            onClick={() => setProfileConnectionTab("following")}
                            className="transition-colors hover:text-[var(--noodle-blue)]"
                          >
                            <span className="font-bold text-[var(--foreground)]">{profileFollowingCount}</span>{" "}
                            Following
                          </button>
                          <button
                            type="button"
                            onClick={() => setProfileConnectionTab("followers")}
                            className="transition-colors hover:text-[var(--noodle-blue)]"
                          >
                            <span className="font-bold text-[var(--foreground)]">{profileFollowerCount}</span> Followers
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-[var(--noodle-divider)]">
                    <div className="grid grid-cols-3 border-b border-[var(--noodle-divider)]">
                      {PROFILE_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setProfileTab(tab.id)}
                          className={cn(
                            "relative flex h-12 items-center justify-center text-sm font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
                            profileTab === tab.id && "text-[var(--foreground)]",
                          )}
                        >
                          {tab.label}
                          {profileTab === tab.id && (
                            <span className="absolute bottom-0 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-[var(--noodle-blue)]" />
                          )}
                        </button>
                      ))}
                    </div>
                    {profileVisiblePosts.length > 0 ? (
                      <div>{profileVisiblePosts.map(renderPostArticle)}</div>
                    ) : (
                      <div className="px-8 py-14 text-center">
                        <p className="text-sm font-semibold text-[var(--muted-foreground)]">
                          Nothing boiling here yet.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : isLoading ? (
                <div className="space-y-0">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex gap-3 border-b border-[var(--noodle-divider)] px-4 py-4">
                      <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--muted)]" />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="h-3 w-40 rounded bg-[var(--muted)]" />
                        <div className="h-3 w-full rounded bg-[var(--muted)]" />
                        <div className="h-3 w-2/3 rounded bg-[var(--muted)]" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : isAccountSearch ? (
                accountSearchResults.length > 0 ? (
                  <div>
                    {accountSearchResults.map((account) => renderAccountRow(account, { showFollowButton: true }))}
                  </div>
                ) : (
                  <div className="px-8 py-14 text-center">
                    <AtSign size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                    <p className="text-base font-bold">No accounts found.</p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                      Try searching by handle, like @mari.
                    </p>
                  </div>
                )
              ) : normalizedPostSearch && timelinePosts.length === 0 ? (
                <div className="px-8 py-14 text-center">
                  <p className="text-base font-bold">No posts found.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Try a different search.
                  </p>
                </div>
              ) : timelineTab === "following" && baseTimelinePosts.length === 0 ? (
                <div className="px-8 py-14 text-center">
                  <AtSign size={38} className="mx-auto mb-4 text-[var(--noodle-blue)]" />
                  <p className="text-base font-bold">Nothing from followed characters yet.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Follow characters from the suggestions panel, then refresh Noodle.
                  </p>
                </div>
              ) : posts.length === 0 ? (
                <div className="px-8 py-14 text-center">
                  <NoodleLogo className="mx-auto mb-5 h-16 w-24 opacity-95" />
                  <p className="text-base font-bold">The plate is empty.</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--muted-foreground)]">
                    Go to the Settings on the left first, invite characters, pick a generation connection, then refresh.
                  </p>
                </div>
              ) : (
                timelinePosts.map(renderPostArticle)
              )}
            </div>
          </main>
          {activeNoodleView === "settings" ? (
            <aside className="hidden w-[22rem] shrink-0 px-4 py-3 xl:block" aria-hidden="true" />
          ) : (
            rightRailContent
          )}
        </div>
      </div>

      {composeOpen && (
        <div className="absolute inset-0 z-[70] flex items-start justify-center bg-black/45 px-3 py-12 sm:px-4 sm:py-16">
          <button
            type="button"
            aria-label="Close post composer"
            onClick={closeComposeModal}
            className="absolute inset-0"
          />
          <section
            className="marinara-chat-popover relative z-10 w-full max-w-[36rem] overflow-hidden rounded-2xl border border-[var(--marinara-chat-chrome-panel-border)] bg-[var(--background)] text-[var(--foreground)] shadow-2xl shadow-black/35"
            style={{ backgroundColor: "var(--background)" }}
          >
            <div className="flex min-h-12 items-center gap-3 border-b border-[var(--noodle-divider)] px-3">
              <button
                type="button"
                onClick={closeComposeModal}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--noodle-blue)] hover:bg-[var(--noodle-blue)]/10"
                title="Close"
              >
                <X size={17} />
              </button>
              <h2 className="text-sm font-bold">New post</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3">
                {personaAccount ? (
                  <Avatar account={personaAccount} />
                ) : (
                  <AtSign size={28} className="text-[var(--noodle-blue)]" />
                )}
                <div className="min-w-0">
                  <textarea
                    autoFocus
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    disabled={!personaAccount}
                    placeholder="What's simmering?"
                    className="min-h-36 w-full resize-none border-0 bg-transparent py-2 text-[1rem] leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:opacity-60"
                  />
                  {attachedImageUrl && (
                    <div className="overflow-hidden rounded-xl border border-[var(--noodle-divider)] bg-[var(--noodle-blue)]/10">
                      <img src={attachedImageUrl} alt="" className="max-h-60 w-full object-cover" />
                      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-[var(--noodle-blue)]">
                        <span className="min-w-0 truncate">Attached image</span>
                        <button
                          type="button"
                          onClick={() => setAttachedImageUrl("")}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--noodle-blue)]/15"
                          title="Remove image"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--noodle-divider)] pt-3 pl-14">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <div ref={modalImageToolRef} className="relative">
                    <NoodleToolButton
                      title="Attach image"
                      active={activeComposerTool === "image"}
                      onClick={() => setActiveComposerTool((current) => (current === "image" ? null : "image"))}
                    >
                      <ImageIcon size={18} />
                    </NoodleToolButton>
                  </div>
                  <div ref={modalPollToolRef} className="relative">
                    <NoodleToolButton
                      title="Create poll"
                      active={activeComposerTool === "poll"}
                      onClick={() => setActiveComposerTool((current) => (current === "poll" ? null : "poll"))}
                    >
                      <ListChecks size={18} />
                    </NoodleToolButton>
                  </div>
                  <div ref={modalMediaToolRef} className="relative">
                    <NoodleToolButton
                      title="Emoji, GIFs and stickers"
                      active={activeComposerTool === "media"}
                      onClick={() => setActiveComposerTool((current) => (current === "media" ? null : "media"))}
                    >
                      <Smile size={18} />
                    </NoodleToolButton>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={!canSubmitPost || createPost.isPending}
                  className="h-9 rounded-full bg-[var(--noodle-blue)] px-6 text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createPost.isPending ? "Posting..." : "Post"}
                </button>
                {composeOpen &&
                  renderComposerToolPopovers({
                    imageRef: modalImageToolRef,
                    pollRef: modalPollToolRef,
                    mediaRef: modalMediaToolRef,
                  })}
              </div>
            </div>
          </section>
        </div>
      )}
      {confirmAction && (
        <Modal
          open={Boolean(confirmAction)}
          onClose={() => {
            if (!confirmActionPending) setConfirmAction(null);
          }}
          title={confirmAction.title}
          width="max-w-sm"
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--foreground)]">{confirmAction.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                disabled={confirmActionPending}
                className="h-9 rounded-md border border-[var(--marinara-chat-chrome-panel-border)] px-4 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmNoodleAction}
                disabled={confirmActionPending}
                className="flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--destructive)] px-4 text-xs font-bold text-[var(--destructive-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmActionPending && <Loader2 size={14} className="animate-spin" />}
                {confirmActionPending ? "Working" : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NumberSetting({
  label,
  help,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  help?: React.ReactNode;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="block space-y-1.5">
      <FieldLabel help={help}>{label}</FieldLabel>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!Number.isFinite(parsed)) {
            setDraft(String(value));
            return;
          }
          onCommit(Math.max(min, Math.min(max, Math.round(parsed))));
        }}
        className={fieldClass}
      />
    </label>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, History, Loader2, RotateCcw, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { DirectionCommand, Message } from "@marinara-engine/shared";
import type { SpriteInfo } from "../../hooks/use-characters";
import { useGameSessions } from "../../hooks/use-game";
import { api } from "../../lib/api-client";
import { audioManager } from "../../lib/game-audio";
import { resolveAssetTag } from "../../lib/asset-fuzzy-match";
import { findReplayableGameSessionChat } from "../../lib/game-session-resolution";
import type { CharacterMap, PersonaInfo } from "../chat/chat-area.types";
import type { AvatarCrop, LegacyAvatarCrop } from "../../lib/utils";
import { buildGameSessionReplayTurns, type GameReplayPresentationCue } from "../../lib/game-session-replay";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { ttsService } from "../../lib/tts-service";
import { GameChoiceCards } from "./GameChoiceCards";
import { GameNarration } from "./GameNarration";

interface SpeakerAvatarInfo {
  url: string;
  crop?: AvatarCrop | LegacyAvatarCrop | null;
  nameColor?: string;
  dialogueColor?: string;
}

const EMPTY_REPLAY_MESSAGES: Message[] = [];

interface GameSessionReplayProps {
  gameId: string;
  sessionNumber: number;
  characterMap: CharacterMap;
  activeCharacterIds: string[];
  personaInfo?: PersonaInfo;
  spriteMap: Map<string, SpriteInfo[]>;
  speakerAvatarMap: Map<string, SpeakerAvatarInfo>;
  gameVoiceVolume: number;
  directionsActive: boolean;
  assetMap: Parameters<typeof resolveAssetTag>[2];
  useMusicDjPlayerMusic: boolean;
  onActiveSpeakerChange: (speaker: { name: string; avatarUrl: string; expression?: string } | null) => void;
  onBackgroundChange: (background: string | null) => void;
  onPlayDirections: (directions: DirectionCommand[]) => void;
  onMessagesLoaded: (messages: Message[]) => void;
  onExit: () => void;
}

export function GameSessionReplay({
  gameId,
  sessionNumber,
  characterMap,
  activeCharacterIds,
  personaInfo,
  spriteMap,
  speakerAvatarMap,
  gameVoiceVolume,
  directionsActive,
  assetMap,
  useMusicDjPlayerMusic,
  onActiveSpeakerChange,
  onBackgroundChange,
  onPlayDirections,
  onMessagesLoaded,
  onExit,
}: GameSessionReplayProps) {
  const gameSessionsQuery = useGameSessions(gameId || null);
  const sessionChat = useMemo(
    () => findReplayableGameSessionChat(gameSessionsQuery.data, sessionNumber),
    [gameSessionsQuery.data, sessionNumber],
  );
  const replayMessagesQuery = useQuery({
    queryKey: ["game", "session-replay", sessionChat?.id ?? ""],
    queryFn: () => api.get<Message[]>(`/chats/${sessionChat!.id}/messages`),
    enabled: !!sessionChat?.id,
    staleTime: 60_000,
  });
  const messages = replayMessagesQuery.data ?? EMPTY_REPLAY_MESSAGES;
  const turns = useMemo(() => buildGameSessionReplayTurns(messages), [messages]);
  const [turnIndex, setTurnIndex] = useState(0);
  const [turnComplete, setTurnComplete] = useState(false);
  const [replayComplete, setReplayComplete] = useState(false);
  const turn = turns[turnIndex] ?? null;
  const presentedTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    setTurnIndex(0);
    setTurnComplete(false);
    setReplayComplete(false);
    presentedTurnIdRef.current = null;
  }, [sessionNumber]);

  useEffect(() => {
    onMessagesLoaded(messages);
    return () => onMessagesLoaded([]);
  }, [messages, onMessagesLoaded]);

  const handlePresentationCue = useCallback(
    (cue: GameReplayPresentationCue, segmentIndex: number | null) => {
      const effects =
        segmentIndex == null ? [cue] : cue.segmentEffects.filter((effect) => effect.segment === segmentIndex);
      for (const effect of effects) {
        if (effect.background) {
          onBackgroundChange(resolveAssetTag(effect.background, "backgrounds", assetMap));
        }
        if (effect.music && !useMusicDjPlayerMusic) {
          audioManager.playMusic(resolveAssetTag(effect.music, "music", assetMap), assetMap);
        }
        if (effect.ambient) {
          audioManager.playAmbient(resolveAssetTag(effect.ambient, "ambient", assetMap), assetMap);
        }
        for (const sfx of effect.sfx ?? []) {
          audioManager.playSfx(resolveAssetTag(sfx, "sfx", assetMap), assetMap);
        }
        if (effect.directions?.length) {
          onPlayDirections(effect.directions);
        }
      }
    },
    [assetMap, onBackgroundChange, onPlayDirections, useMusicDjPlayerMusic],
  );

  const exitReplay = useCallback(() => {
    ttsService.stop();
    const { currentMusic, currentAmbient } = useGameAssetStore.getState();
    if (currentMusic && !useMusicDjPlayerMusic) audioManager.playMusic(currentMusic, assetMap);
    else if (!useMusicDjPlayerMusic) audioManager.stopMusic();
    if (currentAmbient) audioManager.playAmbient(currentAmbient, assetMap);
    else audioManager.stopAmbient();
    onExit();
  }, [assetMap, onExit, useMusicDjPlayerMusic]);

  const advance = useCallback(() => {
    if (turnIndex >= turns.length - 1) {
      setReplayComplete(true);
      return;
    }
    setTurnIndex((current) => current + 1);
    setTurnComplete(false);
  }, [turnIndex, turns.length]);

  const restart = useCallback(() => {
    presentedTurnIdRef.current = null;
    setTurnIndex(0);
    setTurnComplete(false);
    setReplayComplete(false);
  }, []);

  if (gameSessionsQuery.isLoading || (sessionChat && replayMessagesQuery.isLoading)) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-black/70 px-4 py-3 text-sm text-white/80 shadow-lg">
          <Loader2 size={15} className="animate-spin" />
          Loading Session {sessionNumber} replay
        </div>
      </div>
    );
  }

  const replayError =
    gameSessionsQuery.error instanceof Error
      ? gameSessionsQuery.error
      : replayMessagesQuery.error instanceof Error
        ? replayMessagesQuery.error
        : null;

  if (replayError || !sessionChat || !turn) {
    return (
      <div className="flex h-full flex-1 items-center justify-center px-6">
        <div className="max-w-md rounded-xl border border-white/15 bg-black/75 px-5 py-4 text-center shadow-lg">
          <History size={22} className="mx-auto text-white/55" />
          <h2 className="mt-3 text-sm font-semibold text-white">Replay unavailable</h2>
          <p className="mt-1 text-xs leading-relaxed text-white/60">
            {replayError?.message || "This session does not contain any replayable GM turns."}
          </p>
          <button
            type="button"
            onClick={exitReplay}
            className="mari-chrome-control mari-chrome-control--primary mt-4 px-4 py-2 text-xs"
          >
            Return to current session
          </button>
        </div>
      </div>
    );
  }

  const turnMessages = [turn.playerMessage, turn.message].filter((message): message is Message => !!message);
  const choiceLabels = turn.choices.map((choice) => choice.label);
  const recordedChoiceLabel = turn.recordedChoice?.label ?? null;
  const hasChoices = choiceLabels.length > 0;

  const choicesSlot =
    turnComplete && hasChoices && !replayComplete ? (
      <div className="pointer-events-auto mb-2 flex max-h-[clamp(8rem,30svh,14rem)] min-h-0 w-full shrink justify-center overflow-hidden sm:max-h-[clamp(9rem,36svh,20rem)] md:max-h-[min(52dvh,32rem)]">
        <GameChoiceCards
          key={turn.message.id}
          choices={choiceLabels}
          replayChoice={recordedChoiceLabel}
          disabled={!recordedChoiceLabel}
          onSelect={advance}
        />
      </div>
    ) : undefined;

  const inputSlot = turnComplete ? (
    replayComplete ? (
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--foreground)]/75 dark:text-white/75">
          <Check size={13} className="text-emerald-400" />
          Session replay complete
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={restart} className="mari-chrome-control px-3 py-1.5 text-xs">
            <RotateCcw size={12} />
            Watch again
          </button>
          <button
            type="button"
            onClick={exitReplay}
            className="mari-chrome-control mari-chrome-control--primary px-3 py-1.5 text-xs"
          >
            Return to current session
          </button>
        </div>
      </div>
    ) : hasChoices ? (
      !recordedChoiceLabel ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <span className="text-xs text-amber-300/80">The original choice was not recorded for this turn.</span>
          <button type="button" onClick={advance} className="mari-chrome-control px-3 py-1.5 text-xs">
            Continue replay
            <ChevronRight size={12} />
          </button>
        </div>
      ) : undefined
    ) : (
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={advance}
          className="mari-chrome-control mari-chrome-control--primary px-3 py-1.5 text-xs"
        >
          {turnIndex >= turns.length - 1 ? "Finish replay" : "Next turn"}
          <ChevronRight size={12} />
        </button>
      </div>
    )
  ) : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      <div className="pointer-events-auto absolute left-3 right-3 top-3 z-40 flex items-center justify-between gap-3 md:left-4 md:right-4">
        <div className="flex min-w-0 items-center gap-2 rounded-xl border border-white/15 bg-black/70 px-3 py-2 text-white shadow-lg backdrop-blur-md">
          <History size={14} className="shrink-0 text-[var(--primary)]" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">Session {sessionNumber} replay</div>
            <div className="text-[0.625rem] text-white/55">
              Turn {turnIndex + 1} of {turns.length} · Read only
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={exitReplay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/70 text-white/70 shadow-lg backdrop-blur-md transition-colors hover:bg-black/85 hover:text-white"
          title="Return to current session"
          aria-label="Return to current session"
        >
          <X size={15} />
        </button>
      </div>

      <GameNarration
        key={turn.message.id}
        messages={turnMessages}
        isStreaming={false}
        characterMap={characterMap}
        activeCharacterIds={activeCharacterIds}
        personaInfo={personaInfo}
        spriteMap={spriteMap}
        speakerAvatarMap={speakerAvatarMap}
        onActiveSpeakerChange={onActiveSpeakerChange}
        onSegmentEnter={(segmentIndex) => {
          if (presentedTurnIdRef.current !== turn.message.id) {
            presentedTurnIdRef.current = turn.message.id;
            handlePresentationCue(turn.presentation, null);
          }
          handlePresentationCue(turn.presentation, segmentIndex);
        }}
        showUserMessages
        partyDialogue={turn.partyDialogue}
        partyChatMessageId={turn.partyChatMessageId}
        hasStoredNarrationPosition={false}
        restoredSegmentIndex={0}
        onNarrationComplete={(complete, messageId) => {
          if (messageId === turn.message.id || messageId === turn.partyChatMessageId) setTurnComplete(complete);
        }}
        directionsActive={directionsActive}
        gameVoiceVolume={gameVoiceVolume}
        disableVoiceGeneration
        choicesSlot={choicesSlot}
        inputSlot={inputSlot}
      />
    </div>
  );
}

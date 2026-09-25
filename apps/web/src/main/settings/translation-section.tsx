import { Switch } from "~/components/ui/switch";
import { toast } from "../gmail/toast";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon, StarIcon, XIcon } from "lucide-react";
import { gmailApi, type TranslationSettings } from "../gmail/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../gmail/menu";
import { languageName, TRANSLATION_LANGUAGES, useTranslationSettings } from "../gmail/translation";
import { Btn, HintTooltip, IconBtn } from "../gmail/ui";
import { SettingsRow, SettingsSection } from "./settings-ui";

/** Languages the user reads (mail in others offers a translation) + auto-translate. */
export function TranslationSection() {
  const queryClient = useQueryClient();
  const { readLanguages, autoTranslate } = useTranslationSettings();

  const save = async (patch: Partial<TranslationSettings>) => {
    console.log("[Settings:setTranslation]", patch);
    try {
      const saved = await gmailApi.setTranslationSettings(patch);
      queryClient.setQueryData(["translation-settings"], saved);
    } catch (error) {
      toast.error(`Failed to save translation settings: ${error}`);
    }
  };

  const setLanguages = (languages: string[]) => void save({ readLanguages: languages });
  const addable = TRANSLATION_LANGUAGES.filter((code) => !readLanguages.includes(code)).sort(
    (a, b) => languageName(a).localeCompare(languageName(b)),
  );

  return (
    <SettingsSection title="Translation">
      <SettingsRow
        title="Languages I read"
        description="Mail in any other language offers a translation into your starred language. Apple's translator runs on this Mac, so nothing is sent anywhere."
        control={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Btn size="xs" variant="outline">
                <PlusIcon className="size-3.5" />
                Add language
              </Btn>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {addable.map((code) => (
                <DropdownMenuItem
                  key={code}
                  onSelect={() => setLanguages([...readLanguages, code])}
                >
                  {languageName(code)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <ul className="mt-3 mb-2 flex flex-col gap-0.5">
          {readLanguages.map((code, i) => (
            <li
              key={code}
              className="group/lang flex h-8 items-center gap-2 rounded-md pr-1 pl-2 hover:bg-accent-surface/50"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {languageName(code)}
              </span>
              {/* The starred language is where translations go. */}
              {i === 0 ? (
                <HintTooltip label="Translations go into this language">
                  <span className="flex size-6 items-center justify-center">
                    <StarIcon className="size-3.5 fill-current text-warning-foreground" />
                  </span>
                </HintTooltip>
              ) : (
                <HintTooltip label="Translate into this language">
                  <IconBtn
                    label={`Translate into ${languageName(code)}`}
                    className="size-6 opacity-0 group-hover/lang:opacity-100 focus-visible:opacity-100"
                    onClick={() => setLanguages([code, ...readLanguages.filter((c) => c !== code)])}
                  >
                    <StarIcon className="size-3.5" />
                  </IconBtn>
                </HintTooltip>
              )}
              <IconBtn
                label={`Remove ${languageName(code)}`}
                className="size-6"
                disabled={readLanguages.length === 1}
                onClick={() => setLanguages(readLanguages.filter((c) => c !== code))}
              >
                <XIcon className="size-3.5" />
              </IconBtn>
            </li>
          ))}
        </ul>
      </SettingsRow>
      <SettingsRow
        title="Translate automatically"
        description="Show mail in other languages already translated, without asking."
        control={
          <Switch
            id="autoTranslate"
            checked={autoTranslate}
            onCheckedChange={(checked) => void save({ autoTranslate: checked })}
          />
        }
      />
    </SettingsSection>
  );
}

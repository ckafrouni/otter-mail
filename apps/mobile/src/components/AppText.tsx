import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps as RNTextInputProps,
  type TextProps as RNTextProps,
} from "react-native";

import { cn } from "../lib/cn";

export type AppTextProps = RNTextProps & { readonly className?: string };

/** RN Text with the app font and foreground color (Otter Code Mobile's AppText). */
export function AppText({ className, ...props }: AppTextProps) {
  return <RNText className={cn("font-sans text-foreground", className)} {...props} />;
}

export type AppTextInputProps = Omit<RNTextInputProps, "placeholderTextColor"> & {
  readonly className?: string;
  readonly ref?: React.Ref<RNTextInput>;
};

/** RN TextInput with the app font, colors, and caret. */
export function AppTextInput({ className, ref, ...props }: AppTextInputProps) {
  return (
    <RNTextInput
      ref={ref}
      className={cn("font-sans text-base text-foreground", className)}
      placeholderTextColorClassName="accent-placeholder"
      selectionColorClassName="accent-primary"
      cursorColorClassName="accent-primary"
      {...props}
    />
  );
}

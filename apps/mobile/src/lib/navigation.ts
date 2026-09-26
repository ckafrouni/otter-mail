import { type StaticParamList, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { RootStack } from "../Stack";

/** useNavigation() typed for the root native stack, so header options are checked. */
export const useStackNavigation = () =>
  useNavigation<NativeStackNavigationProp<StaticParamList<typeof RootStack>>>();

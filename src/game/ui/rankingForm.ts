// ランキングに名前を登録するフォーム。日本語入力（IME）を使えるよう、ゲーム画面の上に HTML の入力欄を重ねる。
// プレイヤーの情報は保存しないので、毎回空の状態から名前を入力する。

import { NAME_MAX_LENGTH } from "../ranking";

export interface RankingFormHandlers {
  /** 「登録」：名前を受け取って登録する。失敗したら Error を投げる（メッセージをフォームに表示する） */
  onSubmit: (name: string) => Promise<void>;
  /** 「登録しないで終わる」 */
  onSkip: () => void;
}

export interface RankingForm {
  focus: () => void;
  destroy: () => void;
}

export function createRankingForm(container: HTMLElement, handlers: RankingFormHandlers): RankingForm {
  const form = document.createElement("form");
  form.className = "ranking-form";
  form.innerHTML = `
    <label class="ranking-form__label">ランキングに登録する名前</label>
    <div class="ranking-form__row">
      <input class="ranking-form__input" type="text" maxlength="${NAME_MAX_LENGTH}"
        placeholder="名前（${NAME_MAX_LENGTH}文字まで）" autocomplete="off" spellcheck="false" />
      <button class="ranking-form__submit" type="submit">登録</button>
      <button class="ranking-form__skip" type="button">登録しないで終わる</button>
    </div>
    <p class="ranking-form__message" role="status"></p>
  `;
  const input = form.querySelector("input") as HTMLInputElement;
  const submit = form.querySelector(".ranking-form__submit") as HTMLButtonElement;
  const skip = form.querySelector(".ranking-form__skip") as HTMLButtonElement;
  const message = form.querySelector(".ranking-form__message") as HTMLParagraphElement;

  const setBusy = (busy: boolean) => {
    input.disabled = busy;
    submit.disabled = busy;
    skip.disabled = busy;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // 日本語入力の変換中の Enter では送らない
    if ((e as SubmitEvent & { isComposing?: boolean }).isComposing) return;
    message.textContent = "登録中…";
    message.classList.remove("is-error");
    setBusy(true);
    try {
      await handlers.onSubmit(input.value);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : String(error);
      message.classList.add("is-error");
      setBusy(false);
      input.focus();
    }
  });
  skip.addEventListener("click", () => handlers.onSkip());
  // ゲームのキー操作（スペース・エンター）が入力欄に伝わってもゲームが反応しないよう、ここで止める
  form.addEventListener("keydown", (e) => e.stopPropagation());

  container.appendChild(form);
  return {
    focus: () => input.focus(),
    destroy: () => form.remove(),
  };
}

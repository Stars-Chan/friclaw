// src/gateway/weixin-types.ts
export interface WeixinMessage {
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  message_type?: number
  item_list?: MessageItem[]
  context_token?: string
}

export interface MessageItem {
  type: number
  text_item?: { text?: string }
  image_item?: { url?: string; media?: CDNMedia }
  is_completed?: boolean
}

export interface CDNMedia {
  encrypt_query_param?: string
  aes_key?: string
}

export interface GetUpdatesResp {
  ret: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export interface SendMessageReq {
  msg: {
    to_user_id: string
    context_token?: string
    message_type: number
    message_state: number
    item_list?: MessageItem[]
    client_id?: string
  }
}

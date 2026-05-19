export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          artist_id: string | null
          created_at: string | null
          handle: string | null
          id: string
          is_primary: boolean
          platform: string
          status: string | null
          tiktok_access_token_encrypted: string | null
          tiktok_connected_at: string | null
          tiktok_creator_info: Json | null
          tiktok_display_name: string | null
          tiktok_open_id: string | null
          tiktok_refresh_token_encrypted: string | null
          tiktok_scope: string | null
          tiktok_token_expires_at: string | null
        }
        Insert: {
          artist_id?: string | null
          created_at?: string | null
          handle?: string | null
          id?: string
          is_primary?: boolean
          platform?: string
          status?: string | null
          tiktok_access_token_encrypted?: string | null
          tiktok_connected_at?: string | null
          tiktok_creator_info?: Json | null
          tiktok_display_name?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token_encrypted?: string | null
          tiktok_scope?: string | null
          tiktok_token_expires_at?: string | null
        }
        Update: {
          artist_id?: string | null
          created_at?: string | null
          handle?: string | null
          id?: string
          is_primary?: boolean
          platform?: string
          status?: string | null
          tiktok_access_token_encrypted?: string | null
          tiktok_connected_at?: string | null
          tiktok_creator_info?: Json | null
          tiktok_display_name?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token_encrypted?: string | null
          tiktok_scope?: string | null
          tiktok_token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_logs: {
        Row: {
          account_id: string | null
          action: string
          created_at: string | null
          detail: Json | null
          id: string
          post_id: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          created_at?: string | null
          detail?: Json | null
          id?: string
          post_id?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          created_at?: string | null
          detail?: Json | null
          id?: string
          post_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_logs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          created_at: string | null
          id: string
          name: string
          profile: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          profile?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          profile?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      audio_clips: {
        Row: {
          account_id: string
          created_at: string | null
          default_lyric_template_id: string | null
          duration_sec: number
          file_name: string | null
          id: string
          metadata: Json
          perceptual_hash: string | null
          selection_end_sec: number
          selection_start_sec: number
          source_asset_id: string
          transcription_status: string
          trimmed_asset_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          default_lyric_template_id?: string | null
          duration_sec: number
          file_name?: string | null
          id?: string
          metadata?: Json
          perceptual_hash?: string | null
          selection_end_sec: number
          selection_start_sec: number
          source_asset_id: string
          transcription_status?: string
          trimmed_asset_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          default_lyric_template_id?: string | null
          duration_sec?: number
          file_name?: string | null
          id?: string
          metadata?: Json
          perceptual_hash?: string | null
          selection_end_sec?: number
          selection_start_sec?: number
          source_asset_id?: string
          transcription_status?: string
          trimmed_asset_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audio_clips_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_clips_default_lyric_template_id_fkey"
            columns: ["default_lyric_template_id"]
            isOneToOne: false
            referencedRelation: "kanvas_lyric_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_clips_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_clips_trimmed_asset_id_fkey"
            columns: ["trimmed_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_batches: {
        Row: {
          account_id: string | null
          audio_asset_id: string | null
          audio_clip_id: string | null
          cadence_minutes: number
          completed_at: string | null
          created_at: string | null
          dedupe_strategy: string
          duration_seconds: number
          duration_tolerance_fallback_seconds: number
          duration_tolerance_seconds: number
          error_message: string | null
          id: string
          library_status: string
          lyric_template_id: string | null
          next_run_at: string | null
          paused_at: string | null
          post_count: number
          prompt: string | null
          publish_defaults: Json
          quantity: number
          settings: Json
          source_mode: string
          started_at: string | null
          status: string
          timezone: string
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          audio_asset_id?: string | null
          audio_clip_id?: string | null
          cadence_minutes?: number
          completed_at?: string | null
          created_at?: string | null
          dedupe_strategy?: string
          duration_seconds?: number
          duration_tolerance_fallback_seconds?: number
          duration_tolerance_seconds?: number
          error_message?: string | null
          id?: string
          library_status?: string
          lyric_template_id?: string | null
          next_run_at?: string | null
          paused_at?: string | null
          post_count: number
          prompt?: string | null
          publish_defaults?: Json
          quantity?: number
          settings?: Json
          source_mode?: string
          started_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          audio_asset_id?: string | null
          audio_clip_id?: string | null
          cadence_minutes?: number
          completed_at?: string | null
          created_at?: string | null
          dedupe_strategy?: string
          duration_seconds?: number
          duration_tolerance_fallback_seconds?: number
          duration_tolerance_seconds?: number
          error_message?: string | null
          id?: string
          library_status?: string
          lyric_template_id?: string | null
          next_run_at?: string | null
          paused_at?: string | null
          post_count?: number
          prompt?: string | null
          publish_defaults?: Json
          quantity?: number
          settings?: Json
          source_mode?: string
          started_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_batches_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_batches_audio_asset_id_fkey"
            columns: ["audio_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_batches_audio_clip_id_fkey"
            columns: ["audio_clip_id"]
            isOneToOne: false
            referencedRelation: "audio_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_items: {
        Row: {
          account_id: string | null
          attempt_count: number
          audio_clip_id: string | null
          batch_id: string | null
          created_at: string | null
          duration_seconds: number
          duration_tolerance_seconds_used: number | null
          error_message: string | null
          estimated_cost_cents: number | null
          final_asset_id: string | null
          generated_asset_id: string | null
          id: string
          input_payload: Json
          item_index: number
          last_attempt_at: string | null
          library_item_id: string | null
          locked_at: string | null
          locked_by: string | null
          lyric_template_id: string | null
          max_attempts: number
          model_id: string | null
          perceptual_hash: string | null
          post_id: string | null
          prompt: string
          provider: string
          provider_request_id: string | null
          render_callback_token: string | null
          render_job_id: string | null
          render_provider: string | null
          scheduled_at: string
          segments: Json | null
          stage_events: Json
          status: string
          stitched_asset_id: string | null
          stock_clip_url: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          attempt_count?: number
          audio_clip_id?: string | null
          batch_id?: string | null
          created_at?: string | null
          duration_seconds?: number
          duration_tolerance_seconds_used?: number | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          final_asset_id?: string | null
          generated_asset_id?: string | null
          id?: string
          input_payload?: Json
          item_index: number
          last_attempt_at?: string | null
          library_item_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          lyric_template_id?: string | null
          max_attempts?: number
          model_id?: string | null
          perceptual_hash?: string | null
          post_id?: string | null
          prompt: string
          provider: string
          provider_request_id?: string | null
          render_callback_token?: string | null
          render_job_id?: string | null
          render_provider?: string | null
          scheduled_at: string
          segments?: Json | null
          stage_events?: Json
          status?: string
          stitched_asset_id?: string | null
          stock_clip_url?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          attempt_count?: number
          audio_clip_id?: string | null
          batch_id?: string | null
          created_at?: string | null
          duration_seconds?: number
          duration_tolerance_seconds_used?: number | null
          error_message?: string | null
          estimated_cost_cents?: number | null
          final_asset_id?: string | null
          generated_asset_id?: string | null
          id?: string
          input_payload?: Json
          item_index?: number
          last_attempt_at?: string | null
          library_item_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          lyric_template_id?: string | null
          max_attempts?: number
          model_id?: string | null
          perceptual_hash?: string | null
          post_id?: string | null
          prompt?: string
          provider?: string
          provider_request_id?: string | null
          render_callback_token?: string | null
          render_job_id?: string | null
          render_provider?: string | null
          scheduled_at?: string
          segments?: Json | null
          stage_events?: Json
          status?: string
          stitched_asset_id?: string | null
          stock_clip_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generation_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_audio_clip_id_fkey"
            columns: ["audio_clip_id"]
            isOneToOne: false
            referencedRelation: "audio_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_final_asset_id_fkey"
            columns: ["final_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_generated_asset_id_fkey"
            columns: ["generated_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "video_library_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_items_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      kanvas_lyric_template_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          provider: string | null
          response: Json | null
          started_at: string | null
          status: string
          template_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          provider?: string | null
          response?: Json | null
          started_at?: string | null
          status?: string
          template_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          provider?: string | null
          response?: Json | null
          started_at?: string | null
          status?: string
          template_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanvas_lyric_template_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "kanvas_lyric_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      kanvas_lyric_templates: {
        Row: {
          archived_at: string | null
          created_at: string
          cut_markers: Json
          error_message: string | null
          id: string
          lyric_blocks: Json
          render_defaults: Json
          saved_at: string | null
          selection_duration_ms: number
          selection_start_ms: number
          source_audio_asset_id: string | null
          status: string
          title: string
          total_duration_ms: number
          transcript_meta: Json
          trimmed_audio_asset_id: string | null
          updated_at: string
          user_id: string
          waveform_peaks: Json
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          cut_markers?: Json
          error_message?: string | null
          id?: string
          lyric_blocks?: Json
          render_defaults?: Json
          saved_at?: string | null
          selection_duration_ms?: number
          selection_start_ms?: number
          source_audio_asset_id?: string | null
          status?: string
          title?: string
          total_duration_ms?: number
          transcript_meta?: Json
          trimmed_audio_asset_id?: string | null
          updated_at?: string
          user_id: string
          waveform_peaks?: Json
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          cut_markers?: Json
          error_message?: string | null
          id?: string
          lyric_blocks?: Json
          render_defaults?: Json
          saved_at?: string | null
          selection_duration_ms?: number
          selection_start_ms?: number
          source_audio_asset_id?: string | null
          status?: string
          title?: string
          total_duration_ms?: number
          transcript_meta?: Json
          trimmed_audio_asset_id?: string | null
          updated_at?: string
          user_id?: string
          waveform_peaks?: Json
        }
        Relationships: [
          {
            foreignKeyName: "kanvas_lyric_templates_source_audio_asset_id_fkey"
            columns: ["source_audio_asset_id"]
            isOneToOne: false
            referencedRelation: "project_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanvas_lyric_templates_trimmed_audio_asset_id_fkey"
            columns: ["trimmed_audio_asset_id"]
            isOneToOne: false
            referencedRelation: "project_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          account_id: string | null
          byte_size: number | null
          created_at: string | null
          duration_seconds: number | null
          file_name: string | null
          id: string
          kind: string
          metadata: Json
          mime_type: string | null
          public_url: string
          source: string
          storage_bucket: string
          storage_path: string | null
          transcript: Json | null
        }
        Insert: {
          account_id?: string | null
          byte_size?: number | null
          created_at?: string | null
          duration_seconds?: number | null
          file_name?: string | null
          id?: string
          kind: string
          metadata?: Json
          mime_type?: string | null
          public_url: string
          source: string
          storage_bucket?: string
          storage_path?: string | null
          transcript?: Json | null
        }
        Update: {
          account_id?: string | null
          byte_size?: number | null
          created_at?: string | null
          duration_seconds?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string | null
          public_url?: string
          source?: string
          storage_bucket?: string
          storage_path?: string | null
          transcript?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_schedule_slots: {
        Row: {
          account_id: string
          created_at: string | null
          id: string
          name: string
          rule: Json
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          id?: string
          name: string
          rule: Json
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          id?: string
          name?: string
          rule?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_schedule_slots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          account_id: string | null
          artist_id: string | null
          audio_url: string | null
          batch_id: string | null
          caption: string
          created_at: string | null
          error_message: string | null
          final_asset_id: string | null
          generation_item_id: string | null
          hashtags: string[]
          hook_text: string | null
          id: string
          library_item_id: string | null
          likes: number | null
          metadata: Json
          platform: string
          post_type: string
          posted_at: string | null
          privacy_settings: Json
          publish_error: string | null
          publish_status: string | null
          retry_count: number | null
          scheduled_at: string
          status: string
          tiktok_brand_content: boolean
          tiktok_brand_organic: boolean
          tiktok_disable_comment: boolean
          tiktok_disable_duet: boolean
          tiktok_disable_stitch: boolean
          tiktok_is_aigc: boolean
          tiktok_post_id: string | null
          tiktok_privacy_level: string | null
          tiktok_publish_id: string | null
          updated_at: string | null
          video_source: string | null
          video_url: string | null
          views: number | null
        }
        Insert: {
          account_id?: string | null
          artist_id?: string | null
          audio_url?: string | null
          batch_id?: string | null
          caption: string
          created_at?: string | null
          error_message?: string | null
          final_asset_id?: string | null
          generation_item_id?: string | null
          hashtags?: string[]
          hook_text?: string | null
          id?: string
          library_item_id?: string | null
          likes?: number | null
          metadata?: Json
          platform?: string
          post_type?: string
          posted_at?: string | null
          privacy_settings?: Json
          publish_error?: string | null
          publish_status?: string | null
          retry_count?: number | null
          scheduled_at: string
          status?: string
          tiktok_brand_content?: boolean
          tiktok_brand_organic?: boolean
          tiktok_disable_comment?: boolean
          tiktok_disable_duet?: boolean
          tiktok_disable_stitch?: boolean
          tiktok_is_aigc?: boolean
          tiktok_post_id?: string | null
          tiktok_privacy_level?: string | null
          tiktok_publish_id?: string | null
          updated_at?: string | null
          video_source?: string | null
          video_url?: string | null
          views?: number | null
        }
        Update: {
          account_id?: string | null
          artist_id?: string | null
          audio_url?: string | null
          batch_id?: string | null
          caption?: string
          created_at?: string | null
          error_message?: string | null
          final_asset_id?: string | null
          generation_item_id?: string | null
          hashtags?: string[]
          hook_text?: string | null
          id?: string
          library_item_id?: string | null
          likes?: number | null
          metadata?: Json
          platform?: string
          post_type?: string
          posted_at?: string | null
          privacy_settings?: Json
          publish_error?: string | null
          publish_status?: string | null
          retry_count?: number | null
          scheduled_at?: string
          status?: string
          tiktok_brand_content?: boolean
          tiktok_brand_organic?: boolean
          tiktok_disable_comment?: boolean
          tiktok_disable_duet?: boolean
          tiktok_disable_stitch?: boolean
          tiktok_is_aigc?: boolean
          tiktok_post_id?: string | null
          tiktok_privacy_level?: string | null
          tiktok_publish_id?: string | null
          updated_at?: string | null
          video_source?: string | null
          video_url?: string | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_final_asset_id_fkey"
            columns: ["final_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_generation_item_id_fkey"
            columns: ["generation_item_id"]
            isOneToOne: false
            referencedRelation: "generation_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_library_item_id_fkey"
            columns: ["library_item_id"]
            isOneToOne: false
            referencedRelation: "video_library_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_assets: {
        Row: {
          byte_size: number | null
          created_at: string
          duration_ms: number | null
          file_name: string | null
          id: string
          kind: string
          metadata: Json
          mime_type: string | null
          public_url: string | null
          storage_bucket: string
          storage_path: string
          user_id: string
        }
        Insert: {
          byte_size?: number | null
          created_at?: string
          duration_ms?: number | null
          file_name?: string | null
          id?: string
          kind: string
          metadata?: Json
          mime_type?: string | null
          public_url?: string | null
          storage_bucket?: string
          storage_path: string
          user_id: string
        }
        Update: {
          byte_size?: number | null
          created_at?: string
          duration_ms?: number | null
          file_name?: string | null
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string | null
          public_url?: string | null
          storage_bucket?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      publish_attempts: {
        Row: {
          attempted_at: string | null
          error: string | null
          id: string
          post_id: string | null
          raw_response: Json | null
          status: string
          tiktok_publish_id: string | null
        }
        Insert: {
          attempted_at?: string | null
          error?: string | null
          id?: string
          post_id?: string | null
          raw_response?: Json | null
          status: string
          tiktok_publish_id?: string | null
        }
        Update: {
          attempted_at?: string | null
          error?: string | null
          id?: string
          post_id?: string | null
          raw_response?: Json | null
          status?: string
          tiktok_publish_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publish_attempts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      render_attempts: {
        Row: {
          detail: Json
          ended_at: string | null
          error: string | null
          generation_item_id: string
          id: string
          provider: string | null
          request_id: string | null
          stage: string
          started_at: string
          status: string
        }
        Insert: {
          detail?: Json
          ended_at?: string | null
          error?: string | null
          generation_item_id: string
          id?: string
          provider?: string | null
          request_id?: string | null
          stage: string
          started_at?: string
          status: string
        }
        Update: {
          detail?: Json
          ended_at?: string | null
          error?: string | null
          generation_item_id?: string
          id?: string
          provider?: string | null
          request_id?: string | null
          stage?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "render_attempts_generation_item_id_fkey"
            columns: ["generation_item_id"]
            isOneToOne: false
            referencedRelation: "generation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      source_candidate_uses: {
        Row: {
          account_id: string
          audio_clip_id: string | null
          batch_id: string | null
          candidate_id: string
          created_at: string | null
          generation_item_id: string
          id: string
          reused: boolean
          segment_index: number
          tolerance_seconds_used: number | null
        }
        Insert: {
          account_id: string
          audio_clip_id?: string | null
          batch_id?: string | null
          candidate_id: string
          created_at?: string | null
          generation_item_id: string
          id?: string
          reused?: boolean
          segment_index: number
          tolerance_seconds_used?: number | null
        }
        Update: {
          account_id?: string
          audio_clip_id?: string | null
          batch_id?: string | null
          candidate_id?: string
          created_at?: string | null
          generation_item_id?: string
          id?: string
          reused?: boolean
          segment_index?: number
          tolerance_seconds_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "source_candidate_uses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_candidate_uses_audio_clip_id_fkey"
            columns: ["audio_clip_id"]
            isOneToOne: false
            referencedRelation: "audio_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_candidate_uses_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_candidate_uses_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "source_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_candidate_uses_generation_item_id_fkey"
            columns: ["generation_item_id"]
            isOneToOne: false
            referencedRelation: "generation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      source_candidates: {
        Row: {
          account_id: string | null
          attribution: string | null
          cached_url: string | null
          created_at: string | null
          duration_seconds: number
          expires_at: string | null
          external_id: string | null
          height: number | null
          id: string
          is_portrait: boolean
          license: string
          metadata: Json
          origin_url: string
          perceptual_hash: string | null
          provider: string
          rights_holder: string | null
          source_type: string
          storage_bucket: string | null
          storage_path: string | null
          updated_at: string | null
          width: number | null
        }
        Insert: {
          account_id?: string | null
          attribution?: string | null
          cached_url?: string | null
          created_at?: string | null
          duration_seconds: number
          expires_at?: string | null
          external_id?: string | null
          height?: number | null
          id?: string
          is_portrait?: boolean
          license?: string
          metadata?: Json
          origin_url: string
          perceptual_hash?: string | null
          provider: string
          rights_holder?: string | null
          source_type: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string | null
          width?: number | null
        }
        Update: {
          account_id?: string | null
          attribution?: string | null
          cached_url?: string | null
          created_at?: string | null
          duration_seconds?: number
          expires_at?: string | null
          external_id?: string | null
          height?: number | null
          id?: string
          is_portrait?: boolean
          license?: string
          metadata?: Json
          origin_url?: string
          perceptual_hash?: string | null
          provider?: string
          rights_holder?: string | null
          source_type?: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "source_candidates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      video_library_items: {
        Row: {
          account_id: string
          audio_clip_id: string
          batch_id: string | null
          created_at: string | null
          default_caption: string | null
          default_hashtags: string[]
          duration_sec: number
          final_asset_id: string | null
          generation_item_id: string | null
          id: string
          library_index: number
          metadata: Json
          perceptual_hash: string | null
          provenance: Json
          reused_flags: Json
          segments: Json
          status: string
          thumbnail_url: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          audio_clip_id: string
          batch_id?: string | null
          created_at?: string | null
          default_caption?: string | null
          default_hashtags?: string[]
          duration_sec: number
          final_asset_id?: string | null
          generation_item_id?: string | null
          id?: string
          library_index: number
          metadata?: Json
          perceptual_hash?: string | null
          provenance?: Json
          reused_flags?: Json
          segments?: Json
          status?: string
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          audio_clip_id?: string
          batch_id?: string | null
          created_at?: string | null
          default_caption?: string | null
          default_hashtags?: string[]
          duration_sec?: number
          final_asset_id?: string | null
          generation_item_id?: string | null
          id?: string
          library_index?: number
          metadata?: Json
          perceptual_hash?: string | null
          provenance?: Json
          reused_flags?: Json
          segments?: Json
          status?: string
          thumbnail_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_library_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_library_items_audio_clip_id_fkey"
            columns: ["audio_clip_id"]
            isOneToOne: false
            referencedRelation: "audio_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_library_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_library_items_final_asset_id_fkey"
            columns: ["final_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_library_items_generation_item_id_fkey"
            columns: ["generation_item_id"]
            isOneToOne: false
            referencedRelation: "generation_items"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_runs: {
        Row: {
          detail: Json | null
          ended_at: string | null
          errors_count: number | null
          function_name: string
          id: string
          items_processed: number | null
          started_at: string
        }
        Insert: {
          detail?: Json | null
          ended_at?: string | null
          errors_count?: number | null
          function_name: string
          id?: string
          items_processed?: number | null
          started_at?: string
        }
        Update: {
          detail?: Json | null
          ended_at?: string | null
          errors_count?: number | null
          function_name?: string
          id?: string
          items_processed?: number | null
          started_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_generation_items: {
        Args: {
          p_claim_window_minutes?: number
          p_limit?: number
          p_worker_id?: string
        }
        Returns: {
          account_id: string | null
          attempt_count: number
          audio_clip_id: string | null
          batch_id: string | null
          created_at: string | null
          duration_seconds: number
          duration_tolerance_seconds_used: number | null
          error_message: string | null
          estimated_cost_cents: number | null
          final_asset_id: string | null
          generated_asset_id: string | null
          id: string
          input_payload: Json
          item_index: number
          last_attempt_at: string | null
          library_item_id: string | null
          locked_at: string | null
          locked_by: string | null
          lyric_template_id: string | null
          max_attempts: number
          model_id: string | null
          perceptual_hash: string | null
          post_id: string | null
          prompt: string
          provider: string
          provider_request_id: string | null
          render_callback_token: string | null
          render_job_id: string | null
          render_provider: string | null
          scheduled_at: string
          segments: Json | null
          stage_events: Json
          status: string
          stitched_asset_id: string | null
          stock_clip_url: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "generation_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      recover_generation_items: {
        Args: {
          p_include_failed?: boolean
          p_include_stale_active?: boolean
          p_limit?: number
          p_since?: string
        }
        Returns: {
          id: string
          library_item_id: string
          recovered_from: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
